import { describe, expect, test, vi } from "vitest";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InlineNotice } from "@/components/shared/inline-notice";

interface NoticeProps {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
}

/** Depth-first walk of an element tree, so a control can be found by its props. */
function elements(node: ReactNode): ReactElement[] {
  const found: ReactElement[] = [];
  const visit = (value: ReactNode): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child as ReactNode);
      return;
    }
    if (!isValidElement(value)) return;
    found.push(value);
    visit((value.props as { children?: ReactNode }).children);
  };
  visit(node);
  return found;
}

/**
 * `renderToStaticMarkup` covers what a reader is handed. The component is also a
 * pure function of its props, so calling it directly yields the tree React would
 * render — which is the only way to reach a handler without a DOM.
 */
function render(props: NoticeProps) {
  return {
    html: renderToStaticMarkup(createElement(InlineNotice, props)),
    tree: InlineNotice(props),
  };
}

describe("InlineNotice", () => {
  test("is a polite status region, so it is announced without interrupting", () => {
    const { html } = render({ children: "Post opened.", onDismiss: () => {} });
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    // Courtesy notices must not claim the alert role the page's error banners use.
    expect(html).not.toContain('role="alert"');
  });

  test("shows the message it is given", () => {
    const { html } = render({ children: "That post is no longer available.", onDismiss: () => {} });
    expect(html).toContain("That post is no longer available.");
  });

  test("always offers a labelled dismiss control", () => {
    const { html } = render({ children: "Post opened.", onDismiss: () => {} });
    expect(html).toContain('aria-label="Dismiss notice"');
  });

  test("wires that control to the caller's onDismiss", () => {
    const onDismiss = vi.fn();
    const { tree } = render({ children: "Post opened.", onDismiss });

    const dismiss = elements(tree).filter(
      (node) => (node.props as { "aria-label"?: string })["aria-label"] === "Dismiss notice",
    );
    expect(dismiss).toHaveLength(1);

    (dismiss[0].props as { onClick: () => void }).onClick();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  test("renders a control passed as children, not only text", () => {
    const { html, tree } = render({
      children: createElement("button", { type: "button", "aria-keyshortcuts": "Alt+J" }, "Jump"),
      onDismiss: () => {},
    });

    expect(html).toContain("Jump");
    expect(html).toContain('aria-keyshortcuts="Alt+J"');
    expect(elements(tree).some((node) => node.type === "button")).toBe(true);
  });

  test("merges a caller's className with its own", () => {
    const { html } = render({ children: "Post opened.", onDismiss: () => {}, className: "mt-2" });
    expect(html).toContain("mt-2");
    expect(html).toContain("bg-surface-light-blue");
  });
});
