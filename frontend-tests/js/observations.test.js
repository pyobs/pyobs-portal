import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync("pyobs_portal/frontend/static/frontend/js/taskeditor.js", "utf8");
const { loadObservationTable } = new Function(`${source}\nreturn {loadObservationTable};`)();
const pending = { id: 7, state: "pending", start: "2026-10-15T20:00:00Z", end: "2026-10-15T20:01:00Z", target: null };
let request;
beforeEach(() => {
  document.body.innerHTML = '<div class="card"><table id="schedule"><tbody></tbody></table></div>';
  request = vi.fn().mockResolvedValue({ results: [pending] });
  vi.stubGlobal("apiRequest", request);
  vi.spyOn(window, "confirm").mockReturnValue(true);
  vi.spyOn(window, "alert").mockImplementation(() => {});
});
async function draw(rows = [pending]) {
  request.mockResolvedValueOnce({ results: rows });
  const table = document.getElementById("schedule");
  await loadObservationTable("T", table, ["pending", "in_progress"], true);
  return table.querySelector("button");
}
describe("pending observation cancellation", () => {
  it("only shows cancel for pending rows", async () => {
    await draw([pending, { ...pending, id: 8, state: "in_progress" }]);
    expect(document.querySelectorAll("button")).toHaveLength(1);
    expect(document.querySelectorAll("td")).toHaveLength(10);
  });
  it("requires confirmation before POST", async () => {
    const button = await draw();
    window.confirm.mockReturnValue(false);
    button.click();
    expect(request).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(false);
  });
  it("disables the button while posting and refreshes", async () => {
    const button = await draw();
    let finish;
    request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    button.click();
    expect(button.disabled).toBe(true);
    expect(request).toHaveBeenCalledWith("observations/7/cancel/", { method: "POST" });
    finish({ ...pending, state: "canceled" });
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  });
  it.each(["409 state changed", "500 failed"])("shows %s and refreshes after failure", async (message) => {
    const button = await draw();
    request.mockRejectedValueOnce(new Error(message));
    button.click();
    await vi.waitFor(() => expect(window.alert).toHaveBeenCalledWith(message));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
  });
});
