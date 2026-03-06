"use client";
import ArenaPageLayout from "@/components/ArenaPageLayout";
import ArenaDashboard from "@/components/ArenaDashboard";

export default function CommoditiesPage() {
    return (
        <ArenaPageLayout assetClass="COMMODITIES">
            <ArenaDashboard assetClass="COMMODITIES" />
        </ArenaPageLayout>
    );
}
