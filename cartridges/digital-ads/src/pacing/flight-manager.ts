// ---------------------------------------------------------------------------
// Flight Manager — In-memory flight plan storage
// ---------------------------------------------------------------------------

import type { FlightPlan } from "./types.js";

export class FlightManager {
  private readonly flights = new Map<string, FlightPlan>();

  /**
   * Create a new flight plan for a campaign.
   */
  createFlight(params: {
    name: string;
    campaignId: string;
    startDate: string;
    endDate: string;
    totalBudget: number;
    pacingCurve?: "even" | "front-loaded" | "back-loaded";
  }): FlightPlan {
    const id = `flight_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const flight: FlightPlan = {
      id,
      name: params.name,
      campaignId: params.campaignId,
      startDate: params.startDate,
      endDate: params.endDate,
      totalBudget: params.totalBudget,
      pacingCurve: params.pacingCurve ?? "even",
      createdAt: new Date().toISOString(),
    };
    this.flights.set(id, flight);
    return flight;
  }

  /**
   * Retrieve a flight plan by its ID.
   */
  getFlight(flightId: string): FlightPlan | null {
    return this.flights.get(flightId) ?? null;
  }

  /**
   * List all stored flight plans.
   */
  listFlights(): FlightPlan[] {
    return Array.from(this.flights.values());
  }
}
