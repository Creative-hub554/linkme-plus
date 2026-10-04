import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * This module used to be a stub whose four exports rendered their children and
 * nothing else: `TooltipContent`'s text turned up in the page as ordinary text
 * and no tooltip existed anywhere. Nothing in the app uses it, so these are the
 * only thing standing between it and becoming that again — they pin the two
 * properties that tell the difference, and the failure mode of forgetting the
 * provider.
 */
function markup() {
  return renderToStaticMarkup(
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button type="button">Hover me</button>
        </TooltipTrigger>
        <TooltipContent>Tip text</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

describe("Tooltip", () => {
  test("wires the trigger up to Radix rather than passing it through", () => {
    // Radix keeps its state on the trigger. A pass-through would not have it.
    expect(markup()).toContain('data-state="closed"');
  });

  test("keeps the content out of the page until it is open", () => {
    const html = markup();
    expect(html).toContain("Hover me");
    // The stub rendered this inline, which is what made it useless rather than
    // merely absent.
    expect(html).not.toContain("Tip text");
  });

  test("says so, loudly, when the provider is missing", () => {
    // Radix reads the delay and its bookkeeping from the provider's context and
    // throws without one, so a forgotten provider cannot become a tooltip that
    // silently never appears.
    expect(() =>
      renderToStaticMarkup(
        <Tooltip>
          <TooltipTrigger asChild>
            <button type="button">Hover me</button>
          </TooltipTrigger>
          <TooltipContent>Tip text</TooltipContent>
        </Tooltip>
      )
    ).toThrow(/must be used within `TooltipProvider`/);
  });
});
