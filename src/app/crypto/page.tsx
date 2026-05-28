"use client";
import ArenaPageLayout from "@/components/ArenaPageLayout";
import VirtualArenaDashboard from "@/components/VirtualArenaDashboard";

export default function CryptoPage() {
    return (
        <ArenaPageLayout assetClass="CRYPTO">
            <VirtualArenaDashboard />
        </ArenaPageLayout>
    );
}
