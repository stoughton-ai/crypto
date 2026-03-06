"use client";
import ArenaPageLayout from "@/components/ArenaPageLayout";
import ArenaDashboard from "@/components/ArenaDashboard";

export default function NYSEPage() {
    return (
        <ArenaPageLayout assetClass="NYSE">
            <ArenaDashboard assetClass="NYSE" />
        </ArenaPageLayout>
    );
}
