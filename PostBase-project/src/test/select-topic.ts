import { act } from "react";
/** Explicit user choice before publishing/editing; never selects on mount. */
export async function selectPostTopic(topic = "community") {
  const select = document.querySelector<HTMLSelectElement>("select[required]");
  if (!select) throw new Error("Post category picker is missing");
  await act(async () => {
    select.value = topic;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
