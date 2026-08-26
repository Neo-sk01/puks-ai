"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TESTER_KEY } from "@/lib/acceptance";

interface Props {
  name: string | null;
  onName: (name: string) => void;
}

/** First visit: ask who is scoring. The name lives only in this browser;
 *  the API keys verdicts by its normalised form. Base UI's Dialog.Root
 *  takes the same controlled `open`/`onOpenChange` shape as the Radix
 *  primitive this was designed against, so this needed no adaptation. */
export function NameGate({ name, onName }: Props) {
  const [draft, setDraft] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (name === null) {
      try {
        const stored = localStorage.getItem(TESTER_KEY);
        if (stored) onName(stored);
        // localStorage only exists client-side, so this one-time read has to
        // live in an effect rather than a lazy useState initializer (that
        // would throw during the server render pass). The local `open`
        // setState this triggers synchronizes the dialog with that external
        // read, which is exactly what an effect is for — not a value
        // derivable from props/state during render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        else setOpen(true);
      } catch {
        setOpen(true);
      }
    }
  }, [name, onName]);

  const submit = () => {
    const value = draft.trim();
    if (!value || value.length > 60) return;
    try { localStorage.setItem(TESTER_KEY, value); } catch { /* private mode: still works for this visit */ }
    onName(value);
    setOpen(false);
  };

  return (
    <>
      {name && (
        <p className="text-sm text-muted-foreground">
          Scoring as <strong className="text-type">{name}</strong>{" "}
          <button type="button" className="underline hover:text-signal" onClick={() => { setDraft(name); setOpen(true); }}>
            change
          </button>
        </p>
      )}
      <Dialog open={open} onOpenChange={(o) => name && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Who is scoring?</DialogTitle>
            <DialogDescription>Your name is stored with each verdict so the team summary can show who said what.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
            <Input autoFocus maxLength={60} placeholder="Your name" value={draft} onChange={(e) => setDraft(e.target.value)} />
            <Button type="submit" disabled={!draft.trim()}>Start</Button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
