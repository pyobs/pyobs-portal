import { beforeEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
const source = readFileSync("pyobs_portal/frontend/static/frontend/js/admin_projects.js", "utf8");
let request;
beforeEach(async () => {
  const template = readFileSync("pyobs_portal/frontend/templates/frontend/admin_projects.html", "utf8");
  document.body.innerHTML = template;
  request = vi.fn().mockResolvedValue({});
  new Function("apiList", "apiRequest", source)(vi.fn().mockResolvedValue([
    { code: "P", name: "Project", priority: 1, users: [] },
  ]), request);
  await vi.waitFor(() => expect(document.querySelector('#projects-table input[type="number"]')).not.toBeNull());
});
it("rejects invalid dynamic edits and preserves zero", async () => {
  const input = document.querySelector('#projects-table input[type="number"]');
  expect(input.min).toBe("0");
  expect(input.max).toBe("9999");
  for (const value of ["-1", "10000", ""]) {
    input.value = value;
    document.querySelector("#projects-table button").click();
    expect(request).not.toHaveBeenCalled();
  }
  input.value = "0";
  document.querySelector("#projects-table button").click();
  expect(request).toHaveBeenCalledWith("projects/P/", expect.objectContaining({ body: expect.objectContaining({ priority: 0 }) }));
});
it("rejects invalid creation and accepts fractional priority", () => {
  document.getElementById("new-code").value = "NEW";
  document.getElementById("new-name").value = "New";
  const input = document.getElementById("new-priority");
  input.value = "-1";
  document.getElementById("btn-add-project").click();
  expect(request).not.toHaveBeenCalled();
  input.value = "0.25";
  document.getElementById("btn-add-project").click();
  expect(request).toHaveBeenCalledWith("projects/", expect.objectContaining({ body: expect.objectContaining({ priority: .25 }) }));
});
