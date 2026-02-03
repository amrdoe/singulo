import React, { useState, useEffect } from 'react';
import $ from '@singulo/core';
import { Subject, Subscription } from 'rxjs';

interface Message {
    sender: string;
    body: string;
}

const chatSubject = new Subject<Message>();

export const config = {
    route: "/",
};

export default function ProductPage() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [chat, setChat] = useState<Subject<Message> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let sub: Subscription | null = null;

        $(() => chatSubject).then((chat: Subject<Message>) => {
            setChat(chat);
            sub = chat.subscribe((msg: Message) => {
                setMessages((prev) => [...prev, msg]);
            });
        }).catch(err => setError(String(err)));

        return () => sub?.unsubscribe();
    }, []);

    const sendMessage = (sender: string, body: string) => chat?.next({ sender, body });

    if (error) return <div style={{ color: 'red' }}>Error: {error}</div>;
    if (!chat) return <div>Connecting to chat...</div>;

    return (
        <div>
            <h1>Real-time Chat</h1>
            <div style={{ border: '1px solid #ccc', padding: '10px', height: '300px', overflowY: 'scroll', marginBottom: '10px' }}>
                {messages.map((message: Message, index: number) => (
                    <div key={index}>
                        <strong>{message.sender}:</strong> <span>{message.body}</span>
                    </div>
                ))}
            </div>

            <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const sender = formData.get("sender") as string;
                const body = formData.get("body") as string;
                if (sender && body) {
                    sendMessage(sender, body);
                    (e.target as HTMLFormElement).reset();
                }
            }}>
                <div style={{ display: 'flex', gap: '5px' }}>
                    <input type="text" name="sender" placeholder="Name" style={{ width: '100px' }} required />
                    <input type="text" name="body" placeholder="Message" style={{ flex: 1 }} required />
                    <button type="submit">Send</button>
                </div>
            </form>
        </div>
    );
}