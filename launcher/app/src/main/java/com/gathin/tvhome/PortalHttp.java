package com.gathin.tvhome;

import android.os.Handler;
import android.os.Looper;

import java.io.BufferedOutputStream;
import java.io.Closeable;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.UnsupportedEncodingException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * The phone portal's web server, as small as the portal allows: HTTP/1.1 with one request per connection, GET and POST
 * only, and nothing outside "/" and "/api/..." exists. It costs nothing while nobody uses it. One thread waits in
 * accept(), and the threads that answer, three at most, go away after a minute without work.
 *
 * <p>A connection that does not come from the home network is closed before a byte is read: only private and link-local
 * IPv4 addresses and loopback get an answer. A page somewhere on the internet can still make the owner's own phone send
 * requests here, by giving its own name this TV's address (DNS rebinding) or by posting across sites, so a request must
 * also name the TV by an address or a local name in Host, must come from the portal's own page whenever the browser says
 * where it comes from, and must carry its body as JSON, which a plain cross-site form cannot send.
 */
final class PortalHttp {

    interface Routes {
        /** On one of the answering threads. */
        Response answer(Request request);
    }

    static final class Request {
        final String method, path;
        final byte[] body;
        private final Map<String, String> query, headers;

        Request(String method, String path, Map<String, String> query, Map<String, String> headers, byte[] body) {
            this.method = method;
            this.path = path;
            this.query = query;
            this.headers = headers;
            this.body = body;
        }

        /** A header by its lower-case name, or null. */
        String header(String name) {
            return headers.get(name);
        }

        /** A query parameter, decoded, or null. */
        String param(String name) {
            return query.get(name);
        }
    }

    static final class Response {
        final int status;
        final String type;
        final byte[] body;
        /** Extra header lines, each ending in CRLF, or null. */
        final String headers;

        Response(int status, String type, byte[] body, String headers) {
            this.status = status;
            this.type = type;
            this.body = body;
            this.headers = headers;
        }

        static Response json(int status, String json) {
            return new Response(status, JSON, json.getBytes(StandardCharsets.UTF_8), null);
        }

        static Response error(int status, String message) {
            return json(status, "{\"ok\":false,\"error\":" + quote(message) + "}");
        }
    }

    static final String JSON = "application/json; charset=utf-8";

    private static final int HEAD_MAX = 8 * 1024;
    private static final int BODY_MAX = 64 * 1024;
    /** For the whole request, not each read: a client sending a byte every few seconds must not hold a thread. */
    private static final int READ_MS = 5_000;
    /** Past this a connection is cut whatever it is doing, a response that the other end stopped reading included. */
    private static final long CONNECTION_MS = 15_000L;
    private static final int ANSWERING = 3, WAITING = 16, BACKLOG = 16;
    private static final long IDLE_S = 60L;
    /** accept() failing for any reason but the door closing: tried again this many times, a little apart, then left. */
    private static final int ACCEPT_TRIES = 20;
    private static final long ACCEPT_AGAIN_MS = 250L;
    /** Names a home router or mDNS gives out, which nobody on the internet can point at an address of their choice. */
    private static final String[] LOCAL_SUFFIXES = {".local", ".lan", ".home", ".home.arpa", ".internal"};

    private final int port;
    private final Routes routes;
    /** Only for cutting connections that overrun: a post and a removal per request, nothing while there are none. */
    private final Handler timer = new Handler(Looper.getMainLooper());
    private Door door;

    PortalHttp(int port, Routes routes) {
        this.port = port;
        this.routes = routes;
    }

    /** Opens the door unless it is open; one that could not open (the port taken) is tried again. */
    synchronized void start() {
        if (door != null && !door.ended) return;
        door = new Door();
        Thread thread = new Thread(door, "portal-door");
        thread.setDaemon(true);
        thread.start();
    }

    synchronized void stop() {
        if (door == null) return;
        door.close();
        door = null;
    }

    /** One opening of the server, with its own threads, so a stop followed at once by a start never mixes the two. */
    private final class Door implements Runnable {
        private final ThreadPoolExecutor answering;
        private final Set<Socket> open = new HashSet<>();
        private ServerSocket server;
        private boolean closed;
        volatile boolean ended;

        Door() {
            AtomicInteger made = new AtomicInteger();
            answering = new ThreadPoolExecutor(ANSWERING, ANSWERING, IDLE_S, TimeUnit.SECONDS,
                    new LinkedBlockingQueue<>(WAITING), work -> {
                        Thread thread = new Thread(work, "portal-" + made.incrementAndGet());
                        thread.setDaemon(true);
                        return thread;
                    });
            answering.allowCoreThreadTimeOut(true);
        }

        @Override
        public void run() {
            try {
                listen();
            } finally {
                ended = true;
                answering.shutdown();
            }
        }

        private void listen() {
            ServerSocket listening = null;
            try {
                listening = new ServerSocket();
                listening.setReuseAddress(true);
                // 0.0.0.0: every IPv4 address the TV has, today's Wi-Fi address and any it gets later.
                listening.bind(new InetSocketAddress(InetAddress.getByAddress(new byte[4]), port), BACKLOG);
            } catch (IOException taken) {
                closeQuietly(listening);
                return;
            }
            synchronized (this) {
                if (closed) {
                    closeQuietly(listening);
                    return;
                }
                server = listening;
            }
            int failures = 0;
            while (true) {
                Socket client;
                try {
                    client = listening.accept();
                    failures = 0;
                } catch (IOException failed) {
                    if (isClosed() || ++failures > ACCEPT_TRIES) break;
                    try {
                        Thread.sleep(ACCEPT_AGAIN_MS);
                    } catch (InterruptedException stopping) {
                        break;
                    }
                    continue;
                }
                if (!isHomeAddress(client.getInetAddress()) || !track(client)) {
                    closeQuietly(client);
                    continue;
                }
                try {
                    answering.execute(() -> serve(this, client));
                } catch (RejectedExecutionException busy) {
                    untrack(client);
                    closeQuietly(client);
                }
            }
            closeQuietly(listening);
        }

        private synchronized boolean isClosed() {
            return closed;
        }

        synchronized boolean track(Socket client) {
            if (closed) return false;
            open.add(client);
            return true;
        }

        synchronized void untrack(Socket client) {
            open.remove(client);
        }

        synchronized void close() {
            if (closed) return;
            closed = true;
            closeQuietly(server);
            answering.shutdownNow();
            for (Socket client : new ArrayList<>(open)) closeQuietly(client);
            open.clear();
        }
    }

    private void serve(Door door, Socket client) {
        Runnable cut = () -> closeQuietly(client);
        timer.postDelayed(cut, CONNECTION_MS);
        try {
            client.setTcpNoDelay(true);
            Response response;
            try {
                Request request = read(client);
                response = refusal(request);
                if (response == null) response = answer(request);
            } catch (Refused refused) {
                response = Response.error(refused.status, refused.getMessage());
            }
            write(client, response);
        } catch (IOException | RuntimeException gone) {
            // A phone that went away mid-request, or one cut off by the time limits: there is nobody left to answer.
        } finally {
            timer.removeCallbacks(cut);
            door.untrack(client);
            closeQuietly(client);
        }
    }

    private Response answer(Request request) {
        try {
            Response response = routes.answer(request);
            return response != null ? response : Response.error(500, "The TV had no answer.");
        } catch (RuntimeException failed) {
            return Response.error(500, "Something went wrong on the TV.");
        }
    }

    // ---- reading a request ----

    private static final class Refused extends Exception {
        private static final long serialVersionUID = 1L;
        final int status;

        Refused(int status, String message) {
            super(message);
            this.status = status;
        }
    }

    private static Request read(Socket client) throws IOException, Refused {
        long deadline = System.nanoTime() + READ_MS * 1_000_000L;
        InputStream in = client.getInputStream();
        byte[] buffer = new byte[HEAD_MAX];
        int filled = 0, headEnd = -1, bodyStart = -1;
        while (headEnd < 0) {
            if (filled == buffer.length) throw new Refused(431, "The request is too large.");
            waitAtMost(client, deadline);
            int got = in.read(buffer, filled, buffer.length - filled);
            if (got < 0) throw new EOFException();
            for (int i = filled; i < filled + got; i++) {
                if (buffer[i] != '\n') continue;
                int j = i - 1;
                if (j >= 0 && buffer[j] == '\r') j--;
                if (j >= 0 && buffer[j] == '\n') {
                    headEnd = j;
                    bodyStart = i + 1;
                    break;
                }
            }
            filled += got;
        }

        String[] lines = new String(buffer, 0, headEnd, StandardCharsets.ISO_8859_1).split("\n", -1);
        int first = 0;
        while (first < lines.length && line(lines[first]).isEmpty()) first++;
        if (first == lines.length) throw new Refused(400, "Bad request.");
        String[] start = line(lines[first]).split(" ", -1);
        if (start.length != 3 || !start[2].startsWith("HTTP/1.")) throw new Refused(400, "Bad request.");
        String method = start[0], target = start[1];
        if (!method.equals("GET") && !method.equals("POST")) throw new Refused(405, "Only GET and POST are answered here.");
        if (!target.startsWith("/")) throw new Refused(400, "Bad request.");

        Map<String, String> headers = new HashMap<>();
        for (int i = first + 1; i < lines.length; i++) {
            String header = line(lines[i]);
            if (header.isEmpty()) continue;
            char lead = header.charAt(0);
            int colon = header.indexOf(':');
            if (lead == ' ' || lead == '\t' || colon <= 0) throw new Refused(400, "Bad request.");
            String name = header.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = header.substring(colon + 1).trim();
            if (headers.containsKey(name)) {
                // Two lengths or two hosts mean two different requests to whoever reads them; neither is taken.
                if (name.equals("content-length") || name.equals("host")) throw new Refused(400, "Bad request.");
                continue;
            }
            headers.put(name, value);
        }

        int question = target.indexOf('?');
        String path = question < 0 ? target : target.substring(0, question);
        if (!isKnownPath(path)) throw new Refused(404, "There is nothing here.");
        Map<String, String> query = parseQuery(question < 0 ? "" : target.substring(question + 1));

        if (headers.containsKey("transfer-encoding")) throw new Refused(501, "Send the body with a Content-Length.");
        int length = 0;
        String lengthText = headers.get("content-length");
        if (lengthText != null) {
            if (lengthText.isEmpty() || lengthText.length() > 9 || !digits(lengthText)) throw new Refused(400, "Bad request.");
            length = Integer.parseInt(lengthText);
        }
        if (length > BODY_MAX) throw new Refused(413, "That is more than the TV takes.");
        byte[] body = new byte[length];
        if (length > 0) {
            if (method.equals("GET")) throw new Refused(400, "A GET has no body.");
            String type = headers.get("content-type");
            if (type == null || !type.toLowerCase(Locale.ROOT).startsWith("application/json")) {
                throw new Refused(415, "Send the body as JSON.");
            }
            if ("100-continue".equalsIgnoreCase(headers.get("expect"))) {
                OutputStream out = client.getOutputStream();
                out.write("HTTP/1.1 100 Continue\r\n\r\n".getBytes(StandardCharsets.ISO_8859_1));
                out.flush();
            }
            int have = Math.min(length, filled - bodyStart);
            System.arraycopy(buffer, bodyStart, body, 0, have);
            while (have < length) {
                waitAtMost(client, deadline);
                int got = in.read(body, have, length - have);
                if (got < 0) throw new EOFException();
                have += got;
            }
        }
        return new Request(method, path, query, headers, body);
    }

    private static void waitAtMost(Socket client, long deadline) throws IOException {
        long left = (deadline - System.nanoTime()) / 1_000_000L;
        if (left <= 0) throw new SocketTimeoutException();
        client.setSoTimeout((int) Math.min(left, READ_MS));
    }

    private static String line(String raw) {
        return raw.endsWith("\r") ? raw.substring(0, raw.length() - 1) : raw;
    }

    /** "/", or "/api/" and a lower-case name: there is no file behind any path, so nothing can be reached by "..". */
    private static boolean isKnownPath(String path) {
        if (path.equals("/")) return true;
        if (!path.startsWith("/api/") || path.length() == 5 || path.length() > 32) return false;
        for (int i = 5; i < path.length(); i++) {
            char c = path.charAt(i);
            if (c < 'a' || c > 'z') return false;
        }
        return true;
    }

    private static Map<String, String> parseQuery(String raw) throws Refused {
        if (raw.isEmpty()) return Collections.emptyMap();
        Map<String, String> query = new HashMap<>();
        for (String pair : raw.split("&")) {
            if (pair.isEmpty()) continue;
            int equals = pair.indexOf('=');
            String name = equals < 0 ? pair : pair.substring(0, equals);
            String value = equals < 0 ? "" : pair.substring(equals + 1);
            try {
                name = URLDecoder.decode(name, "UTF-8");
                value = URLDecoder.decode(value, "UTF-8");
            } catch (IllegalArgumentException | UnsupportedEncodingException malformed) {
                throw new Refused(400, "Bad request.");
            }
            if (!query.containsKey(name)) query.put(name, value);
        }
        return query;
    }

    /** What the browser says about where a request comes from, checked before any route sees it; null to go on. */
    private static Response refusal(Request request) {
        String host = request.header("host");
        if (!isLocalName(host)) return Response.error(403, "Open this page by the TV's address.");
        String origin = request.header("origin");
        if (origin != null && !origin.equalsIgnoreCase("http://" + host)) {
            return Response.error(403, "Requests from other pages are not taken.");
        }
        if (request.path.startsWith("/api/") && "cross-site".equalsIgnoreCase(request.header("sec-fetch-site"))) {
            return Response.error(403, "Requests from other pages are not taken.");
        }
        return null;
    }

    // ---- writing the answer ----

    private static void write(Socket client, Response response) throws IOException {
        StringBuilder head = new StringBuilder(384)
                .append("HTTP/1.1 ").append(response.status).append(' ').append(reason(response.status)).append("\r\n")
                .append("Content-Type: ").append(response.type).append("\r\n")
                .append("Content-Length: ").append(response.body.length).append("\r\n")
                .append("Cache-Control: no-store\r\n")
                .append("Connection: close\r\n")
                .append("X-Content-Type-Options: nosniff\r\n")
                .append("X-Frame-Options: DENY\r\n")
                .append("Referrer-Policy: no-referrer\r\n");
        if (response.status == 405) head.append("Allow: GET, POST\r\n");
        if (response.headers != null) head.append(response.headers);
        head.append("\r\n");
        OutputStream out = new BufferedOutputStream(client.getOutputStream(), 8 * 1024);
        out.write(head.toString().getBytes(StandardCharsets.ISO_8859_1));
        out.write(response.body);
        out.flush();
        client.shutdownOutput();
    }

    private static String reason(int status) {
        switch (status) {
            case 200: return "OK";
            case 400: return "Bad Request";
            case 401: return "Unauthorized";
            case 403: return "Forbidden";
            case 404: return "Not Found";
            case 405: return "Method Not Allowed";
            case 409: return "Conflict";
            case 413: return "Content Too Large";
            case 415: return "Unsupported Media Type";
            case 429: return "Too Many Requests";
            case 431: return "Request Header Fields Too Large";
            case 500: return "Internal Server Error";
            case 501: return "Not Implemented";
            case 503: return "Service Unavailable";
            default: return status < 500 ? "Client Error" : "Server Error";
        }
    }

    // ---- addresses and names ----

    /** Loopback, or a private or link-local IPv4 address: 10/8, 172.16/12, 192.168/16, 169.254/16. */
    static boolean isHomeAddress(InetAddress address) {
        if (address == null) return false;
        if (address.isLoopbackAddress()) return true;
        byte[] b = address.getAddress();
        if (b.length == 16) {
            // An IPv4 client seen through an IPv6 socket, ::ffff:a.b.c.d.
            for (int i = 0; i < 10; i++) if (b[i] != 0) return false;
            if (b[10] != (byte) 0xFF || b[11] != (byte) 0xFF) return false;
            b = new byte[]{b[12], b[13], b[14], b[15]};
        }
        if (b.length != 4) return false;
        int first = b[0] & 0xFF, second = b[1] & 0xFF;
        return first == 10 || first == 127 || (first == 172 && (second & 0xF0) == 16)
                || (first == 192 && second == 168) || (first == 169 && second == 254);
    }

    /** The Host a request names: an IPv4 address, localhost or a local name, with or without a port. */
    static boolean isLocalName(String host) {
        if (host == null || host.isEmpty() || host.length() > 255) return false;
        String name = host.toLowerCase(Locale.ROOT);
        if (name.startsWith("[")) {
            int end = name.indexOf(']');
            return end > 0 && name.substring(1, end).equals("::1") && isPortOrNothing(name.substring(end + 1));
        }
        int colon = name.indexOf(':');
        if (colon >= 0) {
            if (!isPortOrNothing(name.substring(colon))) return false;
            name = name.substring(0, colon);
        }
        if (name.equals("localhost") || isIpv4(name)) return true;
        for (String suffix : LOCAL_SUFFIXES) {
            if (name.endsWith(suffix) && name.length() > suffix.length()) return isHostName(name);
        }
        return false;
    }

    private static boolean isPortOrNothing(String rest) {
        return rest.isEmpty() || (rest.length() >= 2 && rest.length() <= 6 && rest.charAt(0) == ':' && digits(rest.substring(1)));
    }

    private static boolean isIpv4(String name) {
        String[] parts = name.split("\\.", -1);
        if (parts.length != 4) return false;
        for (String part : parts) {
            if (part.isEmpty() || part.length() > 3 || !digits(part) || Integer.parseInt(part) > 255) return false;
        }
        return true;
    }

    private static boolean isHostName(String name) {
        for (int i = 0; i < name.length(); i++) {
            char c = name.charAt(i);
            if (!(c >= 'a' && c <= 'z') && !(c >= '0' && c <= '9') && c != '-' && c != '.') return false;
        }
        return true;
    }

    private static boolean digits(String text) {
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < '0' || c > '9') return false;
        }
        return !text.isEmpty();
    }

    // ---- small helpers ----

    /** A JSON string literal, for the server's own error messages. */
    static String quote(String text) {
        StringBuilder out = new StringBuilder(text.length() + 2).append('"');
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '"' || c == '\\') {
                out.append('\\').append(c);
            } else if (c < 0x20 || c == 0x2028 || c == 0x2029) {
                out.append(String.format(Locale.ROOT, "\\u%04x", (int) c));
            } else {
                out.append(c);
            }
        }
        return out.append('"').toString();
    }

    static void closeQuietly(Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
        }
    }
}
