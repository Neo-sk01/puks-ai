"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface Props {
  open: boolean;
  name: string;
  onClose: (name: string) => void;
}

/** The reviewer's instructions, written for the support desk rather than for
 *  engineers, and the one thing the tool needs from them: a name. Shown on
 *  first visit and from the "How to review" button; can't be dismissed
 *  without a name because every note is attributed.
 *
 *  The parent keys this on `open`, so each opening mounts fresh with the
 *  current name as the draft — no effect needed to resync it. */
export function GuideDialog({ open, name, onClose }: Props) {
  const [draft, setDraft] = useState(name);
  const submit = () => { const v = draft.trim(); if (v && v.length <= 60) onClose(v); };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && name && onClose(name)}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl font-medium">Reviewing Puks AI&rsquo;s answers</DialogTitle>
          <DialogDescription className="text-sm text-type">
            Puks answers Speed WMS support questions from AGL&rsquo;s documentation. You know Speed and the warehouse; the tool does not.
            Your job is to <strong>read each answer as if a colleague had sent it to you, and mark anything you would correct</strong>.
            You are not grading. You are noticing.
          </DialogDescription>
        </DialogHeader>

        <Section title="What you're looking at">
          <dl className="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
            <dt className="font-medium">Question</dt><dd>What was asked, exactly as typed — in bold at the top of each record.</dd>
            <dt className="font-medium">Must contain</dt><dd>The facts a correct answer needs, and the document they live in. Written when the test set was built; it can itself be wrong, and you should say so.</dd>
            <dt className="font-medium">Status line</dt><dd>What Puks retrieved and how confident it was. <span className="text-verdict-pass">✓</span> means the top document was the expected one; <span className="text-verdict-fail">✗</span> means it wasn&rsquo;t — the answer usually suffers.</dd>
            <dt className="font-medium">Puks&rsquo;s answer</dt><dd>The boxed text — the thing you are judging. Amber means it declined to answer.</dd>
          </dl>
          <p className="mt-2 text-sm">Below the answer, <strong>Source excerpts</strong> show what the retrieved documents actually say, so you can check whether Puks read them correctly.</p>
        </Section>

        <Section title="How to leave a note">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li><strong>Select the words that are wrong</strong> — in the answer, the key, or anywhere — and a small box appears.</li>
            <li><strong>Write what&rsquo;s wrong in your own words</strong>, as you would to a junior colleague. Press Enter to save.</li>
            <li>Nothing wrong? Move on with <strong>Next</strong>. A record with no notes is a record you found acceptable — that is useful too.</li>
            <li>Notes save automatically. Edit or delete them from the right-hand margin.</li>
          </ul>
        </Section>

        <Section title="What counts as wrong, here">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>A step, field, status or menu path that is <strong>not how Speed works</strong></li>
            <li>A must-contain fact that is <strong>missing</strong>, or stated but wrong</li>
            <li>Reference SQL <strong>copied verbatim</strong> when the question needed it adapted</li>
            <li>The answer came from the <strong>wrong document</strong> — general SOP when a client-specific one applies, or a ticket when the procedure was asked</li>
            <li>Something <strong>invented</strong> — a table, column, status or rule you don&rsquo;t recognise</li>
            <li>It <strong>refused</strong> when the documentation does cover this — or <strong>answered</strong> something it should have declined</li>
            <li>Too much: technically right but <strong>buries the point</strong> under unrelated material</li>
            <li>Anything that would make you say &ldquo;no, that&rsquo;s not right&rdquo; on the support desk</li>
          </ul>
        </Section>

        <Section title="Good notes and weak notes">
          <Example good>&ldquo;Stock generation moves Top Stock Input to 1, not 2. Also missed that generated lines can&rsquo;t be deleted.&rdquo;</Example>
          <Example good>&ldquo;This is the general receipt procedure. The question is about L&rsquo;Oréal, which requires sampling on receipt — not mentioned.&rdquo;</Example>
          <Example good>&ldquo;SQL is just the reference script pasted in. Should have put the order number in the WHERE clause.&rdquo;</Example>
          <Example>&ldquo;Wrong.&rdquo; &nbsp; &ldquo;Fail.&rdquo; &nbsp; &ldquo;Hallucination.&rdquo; — say <em>what</em> is wrong; we&rsquo;ll do the sorting.</Example>
        </Section>

        <Section title="Two things not to do">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            <li>Don&rsquo;t try to categorise. Just describe. Patterns are found afterwards, from your descriptions.</li>
            <li>Don&rsquo;t skip the answer key. If <em>it</em> is wrong or incomplete, select it and say so — the test set gets better too.</li>
          </ul>
          <p className="mt-2 text-sm">Blue dashed highlights are <strong>suggestions</strong> from the assistant that found something similar elsewhere. Accept if you agree, dismiss if not — they are guesses, and dismissing is quick.</p>
        </Section>

        <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <Input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Your name (shown on your notes)" maxLength={60} autoComplete="name" />
          <Button type="submit" disabled={!draft.trim()}>Start reviewing</Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-3">
      <h3 className="mb-1.5 font-display text-base font-medium">{title}</h3>
      {children}
    </section>
  );
}
function Example({ good, children }: { good?: boolean; children: React.ReactNode }) {
  return (
    <p className={`my-1 border-l-[3px] bg-bay px-3 py-1.5 text-sm ${good ? "border-l-verdict-pass font-medium text-verdict-pass" : "border-l-verdict-fail text-verdict-fail"}`}>
      <span aria-hidden="true">{good ? "✓ " : "✗ "}</span>{children}
    </p>
  );
}
