/**
 * Date utilities for Indian Standard Time (IST) formatting
 * IST is UTC+5:30 (Asia/Kolkata timezone)
 */

/**
 * Format a date string or Date object to Indian Standard Time with 24-hour format
 * @param dateString - ISO date string or Date object
 * @param formatType - "full" (e.g., "Jan 5, 2025 · 14:30"), "date" (e.g., "Jan 5, 2025"), "time" (e.g., "14:30"), "filename" (e.g., "2025-01-05"), "longDate" (e.g., "January 5, 2025")
 * @returns Formatted date string in IST
 */
export function formatIST(
  dateString: string | Date,
  formatType: "full" | "date" | "time" | "filename" | "longDate" = "full"
): string {
  const date = typeof dateString === "string" ? new Date(dateString) : dateString;

  try {
    // Use Intl API to format in IST timezone
    const options: Intl.DateTimeFormatOptions = {
      timeZone: "Asia/Kolkata",
      hour12: false, // 24-hour format
    };

    if (formatType === "full") {
      options.month = "short";
      options.day = "numeric";
      options.year = "numeric";
      options.hour = "2-digit";
      options.minute = "2-digit";
    } else if (formatType === "date" || formatType === "longDate") {
      options.month = formatType === "longDate" ? "long" : "short";
      options.day = "numeric";
      options.year = "numeric";
    } else if (formatType === "time") {
      options.hour = "2-digit";
      options.minute = "2-digit";
    } else if (formatType === "filename") {
      // For filename: yyyy-MM-dd format
      const istDate = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      const year = istDate.getFullYear();
      const month = String(istDate.getMonth() + 1).padStart(2, "0");
      const day = String(istDate.getDate()).padStart(2, "0");
      return `${year}-${month}-${day}`;
    }

    const formatter = new Intl.DateTimeFormat("en-IN", options);
    const parts = formatter.formatToParts(date);

    // Extract parts and construct the formatted string
    const month = parts.find(p => p.type === "month")?.value || "";
    const day = parts.find(p => p.type === "day")?.value || "";
    const year = parts.find(p => p.type === "year")?.value || "";
    const hour = parts.find(p => p.type === "hour")?.value || "";
    const minute = parts.find(p => p.type === "minute")?.value || "";

    if (formatType === "full") {
      return `${month} ${day}, ${year} · ${hour}:${minute}`;
    } else if (formatType === "date" || formatType === "longDate") {
      return `${month} ${day}, ${year}`;
    } else {
      return `${hour}:${minute}`;
    }
  } catch (error) {
    console.error("Error formatting date to IST:", error);
    // Fallback to default format
    return date.toLocaleString();
  }
}

/**
 * Get current date/time in IST format for creating meetings
 * Returns format: "YYYY-MM-DDTHH:mm:ss" (Indian Standard Time, 24-hour format)
 * @returns Current IST time in ISO-like format
 */
export function getCurrentISTISO(): string {
  const now = new Date();
  // Get IST time string
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour12: false });
  // Parse and format as ISO-like string without timezone
  const istDate = new Date(istString);
  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, "0");
  const day = String(istDate.getDate()).padStart(2, "0");
  const hour = String(istDate.getHours()).padStart(2, "0");
  const minute = String(istDate.getMinutes()).padStart(2, "0");
  const second = String(istDate.getSeconds()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
}

/**
 * @deprecated Use getCurrentISTISO() instead - all times are now in IST
 */
export function getCurrentUTCISO(): string {
  return getCurrentISTISO();
}

/**
 * Convert a date string to IST Date object
 * @param dateString - ISO date string
 * @returns Date object representing the same moment in time (Date objects are always UTC internally)
 */
export function toISTDate(dateString: string): Date {
  return new Date(dateString);
}
