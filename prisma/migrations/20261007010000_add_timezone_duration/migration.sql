-- Webinar timezone + duration (audit finding L-2: dates were entered without a timezone, always
-- shown as IST, and Zoom silently defaulted to 60 minutes).
-- timezone         IANA zone the webinar's wall-clock time is expressed in.
-- durationMinutes  Planned length; sent to Zoom and used for the "ended" estimate.
ALTER TABLE "Campaign" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE "Campaign" ADD COLUMN "durationMinutes" INTEGER NOT NULL DEFAULT 60;
