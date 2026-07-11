import { STRINGS, type Locale } from "@/lib/i18n";

/**
 * A pure-CSS Cardputer. The screen "boots" line by line on page load,
 * like the real 240x135 LCD coming alive. Styles live in globals.css.
 */
export default function CardputerDevice({ locale = "zh" }: { locale?: Locale }) {
  const t = STRINGS[locale];
  return (
    <div className="device" role="img" aria-label="M5Stack Cardputer">
      <div className="device-top">
        <div className="device-screen">
          <p className="screen-line boot-1">M5 CARDPUTER</p>
          <p className="screen-line boot-2">CPU  ESP32-S3 @240MHz</p>
          <p className="screen-line boot-3">WIFI OK   BLE OK</p>
          <p className="screen-line boot-4">
            {t.bootLine}
            <span className="cursor">_</span>
          </p>
        </div>
        <span className="device-silk">240×135 · ST7789V2</span>
      </div>
      <div className="device-keyboard">
        {Array.from({ length: 40 }, (_, i) => (
          <span key={i} className="device-key" />
        ))}
      </div>
    </div>
  );
}
