import React, { useState, useEffect } from 'react';
import { $ } from '@singulo/core';
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
    const [chatMessages, setChatMessages] = useState<Message[]>([]);
    const [channel, setChannel] = useState<Subject<Message> | null>(null);

    useEffect(() => {
        // Subscribe to the chat stream
        // The $.server block returns an object with a subscribe method.
        // The client runtime will promote this to a client-side Observable proxy.
        // We act as if we get a Subject back because we need .next()
        const subscriptionPromise = $.server(() => chatSubject);

        let activeSub: Subscription | null = null;

        subscriptionPromise.then((subject: Subject<Message>) => {
            setChannel(subject);
            activeSub = subject.subscribe((msg: Message) => {
                setChatMessages((prev) => [...prev, msg]);
            });
        });

        return () => {
            if (activeSub) activeSub.unsubscribe();
        };
    }, []);

    const sendMessage = (sender: string, body: string) => {
        if (channel && channel.next) {
            // Push message to server via the bidirectional channel
            channel.next({ sender, body });
        }
    };  

    if (!channel) return <div>Connecting to chat...</div>;

    return (
        <div>
            <h1>Real-time Chat</h1>
            <div style={{ border: '1px solid #ccc', padding: '10px', height: '300px', overflowY: 'scroll', marginBottom: '10px' }}>
                {chatMessages.map((message: Message, index: number) => (
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