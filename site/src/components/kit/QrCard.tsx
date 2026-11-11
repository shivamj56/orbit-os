import qrSvg from "@/assets/brand/qr-release.svg?raw";

/** For visitors on a computer: the download link as a QR code for the phone's camera. */
export function QrCard({ className = "" }: { className?: string }) {
  return (
    <div className={`glass flex items-center gap-4 rounded-2xl p-3 pr-5 text-left ${className}`}>
      <div
        className="size-[5.25rem] shrink-0 rounded-xl bg-white p-1.5 text-[#05070D] ring-1 ring-line [&>svg]:size-full"
        role="img"
        aria-label="QR code that opens the Orbit download page on your phone"
        dangerouslySetInnerHTML={{ __html: qrSvg }}
      />
      <p className="max-w-[12.5rem] text-[0.8125rem] leading-snug text-soft">
        <span className="block text-[0.875rem] font-semibold text-ink">On a computer?</span>
        Scan with your phone's camera to download Orbit there.
      </p>
    </div>
  );
}
