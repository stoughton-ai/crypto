"use client";
import ArenaPageLayout from "@/components/ArenaPageLayout";
import ArenaDashboard from "@/components/ArenaDashboard";

export default function CryptoPage() {
    return (
        <ArenaPageLayout assetClass="CRYPTO">
            <ArenaDashboard />
        </ArenaPageLayout>
    );
}
