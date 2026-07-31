"use client";

import { FormEvent, useState } from "react";
import { CircleAlert, Paperclip, Send } from "lucide-react";
import { apiRequest } from "@/lib/api";

export function ChatDemo() {
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!message.trim()) return;
    setStatus("");
    const token = localStorage.getItem("fitconnect_token");
    try {
      await apiRequest("/v1/chat-rooms/1/messages", {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: JSON.stringify({ message: message.trim() }),
      });
      setMessage("");
      setStatus("ส่งข้อความแล้ว");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "ส่งข้อความไม่สำเร็จ");
    }
  }

  return (
    <div className="chat-layout">
      <aside className="chat-sidebar">
        <p className="label">ห้องสนทนา</p>
        <button className="chat-contact is-active" type="button"><span>ก</span><div><strong>เทรนเนอร์สาธิต ก.</strong><small>คำขอ BK-DEMO-001</small></div></button>
      </aside>
      <section className="chat-thread" aria-labelledby="chat-title">
        <header><div><p className="label">ข้อมูลสาธิต</p><h2 id="chat-title">เทรนเนอร์สาธิต ก.</h2></div><span className="status-dot">ยังไม่เชื่อมเซิร์ฟเวอร์</span></header>
        <div className="messages" aria-live="polite">
          <div className="message message--incoming"><p>ห้องนี้แสดงโครงสนทนาสำหรับนัดหมาย เมื่อเชื่อม XAMPP แล้วข้อความใหม่จะถูกบันทึกในฐานข้อมูล</p><span>ตัวอย่าง</span></div>
        </div>
        <div className="form-message-slot" aria-live="polite">
          {status && <div className="form-message form-message--error" role="status"><CircleAlert aria-hidden="true" size={17} /> {status}</div>}
        </div>
        <form className="message-form" onSubmit={sendMessage}>
          <button className="icon-button" type="button" disabled aria-label="แนบไฟล์ (ยังไม่เปิดใช้งาน)"><Paperclip aria-hidden="true" /></button>
          <label className="sr-only" htmlFor="chat-message">ข้อความ</label>
          <input id="chat-message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="พิมพ์ข้อความเกี่ยวกับการนัดหมาย" />
          <button className="button button--accent" type="submit">ส่ง <Send aria-hidden="true" size={17} /></button>
        </form>
      </section>
    </div>
  );
}
