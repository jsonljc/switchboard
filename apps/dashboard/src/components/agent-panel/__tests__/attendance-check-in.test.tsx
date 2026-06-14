import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

// Controllable mock for useRecordAttendance
let mutateMock = vi.fn();
let isPending = false;

vi.mock("@/hooks/use-record-attendance", () => ({
  useRecordAttendance: () => ({ mutate: mutateMock, isPending }),
}));

import { AttendanceCheckIn } from "../attendance-check-in";

describe("AttendanceCheckIn", () => {
  beforeEach(() => {
    mutateMock = vi.fn();
    isPending = false;
  });

  it("renders 'Attended' and 'No-show' buttons", () => {
    render(<AttendanceCheckIn bookingId="bk_1" />);
    expect(screen.getByRole("button", { name: "Attended" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "No-show" })).toBeInTheDocument();
  });

  it("clicking 'Attended' calls mutate with outcome:attended", () => {
    render(<AttendanceCheckIn bookingId="bk_2" />);
    fireEvent.click(screen.getByRole("button", { name: "Attended" }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith({ bookingId: "bk_2", outcome: "attended" });
  });

  it("clicking 'No-show' calls mutate with outcome:no_show", () => {
    render(<AttendanceCheckIn bookingId="bk_3" />);
    fireEvent.click(screen.getByRole("button", { name: "No-show" }));
    expect(mutateMock).toHaveBeenCalledTimes(1);
    expect(mutateMock).toHaveBeenCalledWith({ bookingId: "bk_3", outcome: "no_show" });
  });

  it("both buttons are disabled while isPending is true", () => {
    isPending = true;
    render(<AttendanceCheckIn bookingId="bk_4" />);
    expect(screen.getByRole("button", { name: "Attended" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "No-show" })).toBeDisabled();
  });

  it("buttons are enabled when not pending", () => {
    render(<AttendanceCheckIn bookingId="bk_5" />);
    expect(screen.getByRole("button", { name: "Attended" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "No-show" })).not.toBeDisabled();
  });
});
