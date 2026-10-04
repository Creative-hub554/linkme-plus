"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Link2, QrCode, Share2, Check } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ProfileQrCardProps {
  name: string;
  username: string;
  openSignal?: number;
}

export function ProfileQrCard({ name, username, openSignal = 0 }: ProfileQrCardProps) {
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  useEffect(() => {
    if (openSignal > 0) setShowQr(true);
  }, [openSignal]);

  const profileUrl = useMemo(() => {
    if (typeof window === "undefined") return `/profile?username=${encodeURIComponent(username)}`;
    return `${window.location.origin}/profile?username=${encodeURIComponent(username)}`;
  }, [username]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(profileUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const shareProfile = async () => {
    if (navigator.share) {
      await navigator.share({ title: `${name} on LinkMe+`, text: `Connect with ${name} on LinkMe+`, url: profileUrl });
      return;
    }
    await copyLink();
  };

  const downloadQr = () => {
    const svg = document.getElementById("linkme-profile-qr");
    if (!svg) return;
    const source = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${username}-linkme-qr.svg`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="mt-4 overflow-hidden border-brand-blue/15 bg-gradient-to-br from-card via-card to-brand-blue/5 shadow-sm">
      <CardContent className="p-3 sm:p-4">
        <div className="min-w-0 flex-1 text-center sm:text-left">
          <div className="flex items-center justify-center gap-2 text-brand-blue sm:justify-start">
            <QrCode className="h-4 w-4" />
            <p className="text-xs font-bold uppercase tracking-[0.16em]">Share your profile</p>
          </div>
          <h2 className="mt-1 text-base font-semibold text-navy-800">Let people find you instantly.</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Use the button below to open {name}&apos;s QR code.</p>
          <p className="mt-2 truncate text-xs text-muted-foreground">{profileUrl}</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2 sm:justify-start">
            <Button type="button" size="sm" onClick={() => void shareProfile()}>
              <Share2 className="mr-1.5 h-4 w-4" />
              Share
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => void copyLink()}>
              {copied ? <Check className="mr-1.5 h-4 w-4 text-emerald-600" /> : <Link2 className="mr-1.5 h-4 w-4" />}
              {copied ? "Copied" : "Copy link"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={downloadQr}>
              <Download className="mr-1.5 h-4 w-4" />
              Download
            </Button>
          </div>
        </div>
      </CardContent>
      {showQr && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-navy-950/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`${name}'s profile QR code`}
          onClick={() => setShowQr(false)}
        >
          <div className="rounded-3xl bg-card p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex justify-end">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowQr(false)} aria-label="Close QR code">Close</Button>
            </div>
            <QRCodeSVG id="linkme-profile-qr" value={profileUrl} size={280} bgColor="#ffffff" fgColor="#071426" level="H" includeMargin title={`QR code for ${name}'s LinkMe+ profile`} />
            <p className="mt-3 text-center text-sm font-medium text-navy-800">Scan to connect with {name}</p>
          </div>
        </div>
      )}
    </Card>
  );
}
