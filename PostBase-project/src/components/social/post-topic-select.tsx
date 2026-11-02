"use client";
import { useId } from "react";
import { feedTopics } from "@/lib/feed-topics";
export function PostTopicSelect({ value, onChange }: { value: string; onChange(value: string): void }) {
  const id = useId();
  return <div className="space-y-1">
    <label htmlFor={id} className="text-sm font-medium">Post category / ប្រភេទប្រកាស <span aria-hidden="true">*</span></label>
    <select id={id} value={value} required onChange={event => onChange(event.target.value)} className="w-full rounded-md border bg-background p-2 text-sm">
      <option value="" disabled>Choose a category / ជ្រើសរើសប្រភេទ</option>
      {feedTopics.map(topic => <option key={topic.id} value={topic.id}>{topic.en} / {topic.km}</option>)}
    </select>
  </div>;
}
