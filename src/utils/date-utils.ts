export class DateUtils {
    /** Convert distance in km to travel time in milliseconds */
    static distanceToTravelTime(distanceKm: number, maxDailyDistance: number): number {
        const kmPerHour = maxDailyDistance / 24;
        const hoursToTravel = distanceKm / kmPerHour;
        return hoursToTravel * 60 * 60 * 1000;
    }

    /** Add travel time to a date */
    static addTravelTime(date: Date, distanceKm: number, maxDailyDistance: number): Date {
        const travelTimeMs = this.distanceToTravelTime(distanceKm, maxDailyDistance);
        return new Date(date.getTime() + travelTimeMs);
    }

    /** Compare two dates */
    static compare(date1: Date, date2: Date): number {
        return date1.getTime() - date2.getTime();
    }

    /** Check if date1 is after date2 */
    static isAfter(date1: Date, date2: Date): boolean {
        return date1.getTime() > date2.getTime();
    }

    /** Check if date1 is before date2 */
    static isBefore(date1: Date, date2: Date): boolean {
        return date1.getTime() < date2.getTime();
    }

    /** Format date for display (UTC timezone) */
    static formatUTC(date: Date): string {
        return date.toISOString().replace('T', ' ').replace('Z', ' UTC');
    }

    /** Parse ISO date string ensuring UTC timezone */
    static parseUTC(dateString: string): Date {
        const date = new Date(dateString);
        if (isNaN(date.getTime())) {
            throw new Error(`Invalid date string: ${dateString}`);
        }
        return date;
    }

    /** Get difference between two dates in hours */
    static diffInHours(date1: Date, date2: Date): number {
        return (date1.getTime() - date2.getTime()) / (60 * 60 * 1000);
    }

    /** Get difference between two dates in days */
    static diffInDays(date1: Date, date2: Date): number {
        return this.diffInHours(date1, date2) / 24;
    }
}
