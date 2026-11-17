"use client";

import { useState, type FormEvent } from "react";
import type {
  ChatThread,
  JobOpportunity,
  MarketplaceItem,
  SocialPost,
} from "@/types/linkme";
import { Avatar } from "./primitives";

export function Messages({
  threads,
  selected,
  select,
  send,
  compact = false,
}: {
  threads: ChatThread[];
  selected: string;
  select: (id: string) => void;
  send: (thread: string, text: string) => void;
  compact?: boolean;
}) {
  const thread = threads.find((item) => item.id === selected) ?? threads[0];
  return (
    <div className="ld-stack">
      {!compact && (
        <div className="ld-heading">
          <div>
            <h1>Messages</h1>
            <p>Conversations with your people.</p>
          </div>
        </div>
      )}
      <div className={compact ? "ld-stack" : "ld-message-grid"}>
        <section
          className="ld-glass ld-stack ld-thread-list"
          aria-label="Conversations"
        >
          {threads.map((item) => (
            <button
              type="button"
              key={item.id}
              className={
                "ld-contact " + (thread.id === item.id ? "ld-selected" : "")
              }
              aria-pressed={thread.id === item.id}
              onClick={() => select(item.id)}
            >
              <Avatar
                name={item.participant.name}
                url={item.participant.avatarUrl}
              />
              <span>
                <strong>{item.participant.name}</strong>
                <small>{item.lastMessage || "Start a conversation"}</small>
              </span>
              {item.unreadCount > 0 && (
                <span
                  className="ld-chip"
                  aria-label={item.unreadCount + " unread messages"}
                >
                  {item.unreadCount}
                </span>
              )}
            </button>
          ))}
        </section>
        <section
          className="ld-glass ld-stack ld-conversation"
          aria-label={"Conversation with " + thread.participant.name}
        >
          <div className="ld-row">
            <Avatar
              name={thread.participant.name}
              url={thread.participant.avatarUrl}
            />
            <div>
              <h2>{thread.participant.name}</h2>
              <p className="ld-meta">
                {thread.participant.online ? "Online" : "Offline"}
              </p>
            </div>
          </div>
          <div className="ld-chat-log" role="log" aria-label="Messages">
            {thread.messages.length ? (
              thread.messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    "ld-bubble " +
                    (message.senderId === thread.participant.id
                      ? ""
                      : "ld-mine")
                  }
                >
                  <span className="sr-only">
                    {message.senderId === thread.participant.id
                      ? thread.participant.name
                      : "You"}
                    :{" "}
                  </span>
                  {message.text}
                  <small>{message.timestamp}</small>
                </div>
              ))
            ) : (
              <p className="ld-meta">No messages yet.</p>
            )}
          </div>
          <form
            key={thread.id}
            className="ld-chat-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              const message = String(
                new FormData(form).get("message") ?? "",
              ).trim();
              if (!message) return;
              send(thread.id, message);
              form.reset();
            }}
          >
            <label
              className="sr-only"
              htmlFor={compact ? "ld-quick-message" : "ld-message"}
            >
              Message
            </label>
            <input
              id={compact ? "ld-quick-message" : "ld-message"}
              name="message"
              maxLength={1000}
              required
              placeholder="Write a message"
            />
            <button className="ld-button ld-primary">Send</button>
          </form>
        </section>
      </div>
    </div>
  );
}

export type DraftKind = "post" | "listing" | "job";
export type Draft =
  | { kind: "post"; content: SocialPost["content"] }
  | {
      kind: "listing";
      title: string;
      description: string;
      price: number;
      location: string;
      category: MarketplaceItem["category"];
      condition: MarketplaceItem["condition"];
    }
  | {
      kind: "job";
      title: string;
      description: string;
      company: string;
      location: string;
      workModel: JobOpportunity["workModel"];
      salaryRange: string;
    };

export function CreateForm({
  kind,
  submit,
}: {
  kind: DraftKind;
  submit: (draft: Draft) => void;
}) {
  const [error, setError] = useState("");
  function submitForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const value = (name: string) => String(values.get(name) ?? "").trim();
    const description = value("description");
    const title = value("title");
    const location = value("location");
    if (
      !description ||
      (kind !== "post" && (!title || !location)) ||
      (kind === "job" && !value("company"))
    ) {
      setError("Complete the required fields.");
      return;
    }
    if (kind === "post") submit({ kind, content: description });
    if (kind === "listing")
      submit({
        kind,
        title,
        description,
        location,
        price: Number(value("price")),
        category: value("category") as MarketplaceItem["category"],
        condition: value("condition") as MarketplaceItem["condition"],
      });
    if (kind === "job")
      submit({
        kind,
        title,
        description,
        location,
        company: value("company"),
        salaryRange: value("salary"),
        workModel: value("work") as JobOpportunity["workModel"],
      });
  }
  return (
    <form className="ld-stack" onSubmit={submitForm}>
      {kind !== "post" && (
        <>
          <label>
            Title
            <input name="title" maxLength={120} required />
          </label>
          <label>
            Location
            <input name="location" maxLength={80} required />
          </label>
        </>
      )}
      {kind === "listing" && (
        <>
          <label>
            Price in USD
            <input
              type="number"
              name="price"
              min="0"
              max="1000000"
              step=".01"
              required
            />
          </label>
          <label>
            Category
            <select name="category">
              {["Tech & Gear", "Design Assets", "Workspace", "Apparel"].map(
                (item) => (
                  <option key={item}>{item}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Condition
            <select name="condition">
              {["New", "Like New", "Digital Download", "Good"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        </>
      )}
      {kind === "job" && (
        <>
          <label>
            Company
            <input name="company" maxLength={80} required />
          </label>
          <label>
            Work model
            <select name="work">
              {["Remote", "Hybrid", "On-site"].map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
          <label>
            Salary range
            <input name="salary" maxLength={60} />
          </label>
          <label className="ld-check">
            <input type="checkbox" required /> Attach sample private office
            evidence
          </label>
          <p className="ld-meta">
            Your sample listing is saved for review. It stays out of the public
            job board.
          </p>
        </>
      )}
      <label>
        {kind === "post" ? "Post" : "Description"}
        <textarea name="description" required rows={4} maxLength={2000} />
      </label>
      {error && <p role="alert">{error}</p>}
      <button className="ld-button ld-primary">
        {kind === "post"
          ? "Publish post"
          : kind === "listing"
            ? "Publish listing"
            : "Submit for review"}
      </button>
    </form>
  );
}
