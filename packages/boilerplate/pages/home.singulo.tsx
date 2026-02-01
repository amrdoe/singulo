import React, { useState, useEffect } from 'react';
import { $ } from '@singulo/core';

interface Message {
    sender: string;
    body: string;
}

const chat: Message[] = []

function postMessage(sender: string, body: string) {
    chat.push({ sender, body })
    return chat
}

export const config = {
    route: "/",
};

export default function ProductPage() {
    const [messages, setMessages] = useState<Message[]>([]);

    useEffect(() => {
        $.server(() => chat).then(setMessages)
    }, []);

    if (!messages) return <div>Loading Chat...</div>;

    return (
        <div>
            {messages.map((message: Message, index: number) => (
                <div key={index}>
                    <p>{message.sender}</p>
                    <p>{message.body}</p>
                </div>
            ))}

            <form onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const sender = formData.get("sender") as string;
                const body = formData.get("body") as string;
                $.server((sender, body) => postMessage(sender, body), [sender, body]).then(setMessages);
            }}>
                <input type="text" name="sender" />
                <input type="text" name="body" />
                <button type="submit">Post</button>
            </form>
        </div>
    );
}