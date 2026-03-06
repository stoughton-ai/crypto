"use client";
import ArenaPageLayout from "@/components/ArenaPageLayout";
import ArenaDashboard from "@/components/ArenaDashboard";

export default function FTSEPage() {
    return (
        <ArenaPageLayout assetClass="FTSE">
            <ArenaDashboard assetClass="FTSE" />
        </ArenaPageLayout>
    );
}
