import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import App from "../App";

describe("smoke", () => {
  it("renders app root", () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("app-root")).toBeInTheDocument();
  });

  it("serves the component gallery at /__ui in dev", async () => {
    render(
      <MemoryRouter initialEntries={["/__ui"]}>
        <App />
      </MemoryRouter>,
    );
    expect(await screen.findByTestId("ui-gallery")).toBeInTheDocument();
  });
});
