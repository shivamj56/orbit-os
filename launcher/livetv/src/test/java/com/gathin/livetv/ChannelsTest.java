package com.gathin.livetv;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.List;
import java.util.Map;

import org.junit.Test;

/** The daily refresh may follow a channel to a new address on its own servers, and nowhere else. */
public class ChannelsTest {

    private static final String LIST = String.join("\n",
            "#EXTM3U",
            "#EXTINF:-1 tvg-id=\"AajTak.in@HD\" tvg-logo=\"x\" group-title=\"News\",Aaj Tak HD (1080p)",
            "https://feeds.intoday.in/aajtak/api/aajtakhd/new.m3u8",
            "#EXTINF:-1 tvg-id=\"AajTak.in@HD\",Aaj Tak HD (relay)",
            "https://raw.githubusercontent.com/someone/relay/main/aajtak.m3u8",
            "#EXTINF:-1 tvg-id=\"AajTak.in@HD\",Aaj Tak HD (bare address)",
            "http://103.213.31.109/aajtak/index.m3u8",
            "#EXTINF:-1 tvg-id=\"SansadTV1.in@SD\",Sansad TV 1",
            "#EXTVLCOPT:http-referrer=https://webcast.gov.in/",
            "https://playhls.media.nic.in/hls/live/lstv/next.m3u8",
            "#EXTINF:-1 tvg-id=\"StarPlus.in@HD\",StarPlus",
            "https://somewhere.example/starplus.m3u8",
            "#EXTINF:-1 tvg-id=\"AajTak.in@HD\",Aaj Tak HD again",
            "https://feeds.intoday.in/aajtak/api/aajtakhd/new.m3u8",
            "");

    private static List<Channels.Channel> channels() {
        return Arrays.asList(
                new Channels.Channel("aajtakhd", "AajTak.in@HD", "feeds.intoday.in"),
                new Channels.Channel("sansadtv", "SansadTV1.in@SD", "d2lk5u59tns74c.cloudfront.net", "playhls.media.nic.in"));
    }

    @Test
    public void takesOnlyTheChannelsOwnServers() {
        Map<String, List<Channels.Stream>> found = Channels.fromList(LIST, channels());
        List<Channels.Stream> aajtak = found.get("aajtakhd");
        assertEquals(1, aajtak.size());
        assertEquals("https://feeds.intoday.in/aajtak/api/aajtakhd/new.m3u8", aajtak.get(0).url);
    }

    @Test
    public void keepsTheReferrerThatGoesWithAStream() {
        Channels.Stream s = Channels.fromList(LIST, channels()).get("sansadtv").get(0);
        assertEquals("https://playhls.media.nic.in/hls/live/lstv/next.m3u8", s.url);
        assertEquals("https://webcast.gov.in/", s.referrer);
        assertNull(s.userAgent);
    }

    @Test
    public void aChannelNotInTheListGetsNothing() {
        Map<String, List<Channels.Stream>> found = Channels.fromList(LIST, channels());
        assertFalse(found.containsKey("starplus"));
        assertEquals(2, found.size());
    }

    @Test
    public void hostIsReadFromTheAddress() {
        assertEquals("feeds.intoday.in", new Channels.Stream("https://feeds.intoday.in/a/b.m3u8", null, null).host());
        assertEquals("", new Channels.Stream("not an address", null, null).host());
        assertTrue(new Channels.Stream("https://103.213.31.109/x.m3u8", null, null).host().startsWith("103."));
    }
}
