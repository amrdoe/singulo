import React, { useState, useEffect } from 'react';
import { $ } from '@singulo/core';

// Top-level dependencies that should be extracted
const DB_URL = "postgres://localhost:5432";

function connectToDb() {
    console.log("Connecting to", DB_URL);
    return {
        products: {
            find: async (id: string) => ({ id, name: "Singulo Pro (Extracted)", price: 999 })
        }
    };
}

export const config = {
    route: "/",
};

export default function ProductPage() {
    const [product, setProduct] = useState<any>(null);

    useEffect(() => {
        $.server(() => connectToDb().products.find("123")).then(product => setProduct(product))
    }, []);

    if (!product) return <div>Loading Product...</div>;

    return (
        <div>
            <h1>{product.name}</h1>
            <p>Price: ${product.price}</p>
        </div>
    );
}
