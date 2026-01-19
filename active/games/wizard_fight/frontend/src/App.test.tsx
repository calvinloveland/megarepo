import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders wizard fight header", () => {
  render(<App />);
  expect(screen.getByText(/Wizard Fight/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Cast Flying Monkey/i })).toBeInTheDocument();
});
