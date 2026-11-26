"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, KeyRound, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { INDUSTRY_TEMPLATES } from "@/data/terminology";
import { suggestSlug } from "@/lib/workspaceSlug";
import { checkWorkspaceAvailability } from "@/server/authServer/signupServer";
import {
  createCompanyForCustomer,
  findCompanyOwner,
} from "@/server/tenantServer/provisionServer";

/**
 * "New company" in the platform console: what the register page asks, plus
 * who runs it — someone new, or someone who already runs a company here
 * (another branch or business of theirs, optionally on the same bill).
 * server/tenantServer/provisionServer.js does the work.
 *
 * `ownerEmail` opens it ready to add a company for that person — the button
 * on a company's own page.
 */

const EMPTY = {
  companyName: "",
  slug: "",
  industry: "",
  description: "",
  start: "trial",
  trialDays: "",
  ownerMode: "new",
  owner: { name: "", email: "", phone: "", password: "" },
  existingEmail: "",
  billTogether: true,
  billWithCompanyId: "",
};

function randomPassword() {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  const base = btoa(String.fromCharCode(...bytes)).replace(/[+/=]/g, "");
  return `${base}-7a!`;
}

const initialForm = (ownerEmail) =>
  ownerEmail ? { ...EMPTY, ownerMode: "existing", existingEmail: ownerEmail } : EMPTY;

export default function NewCompanyDialog({ ownerEmail = "", label = "New company", variant }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(() => initialForm(ownerEmail));
  const [slugEdited, setSlugEdited] = useState(false);
  const [availability, setAvailability] = useState(null);
  const [person, setPerson] = useState(null);
  const [lookupError, setLookupError] = useState("");
  const [done, setDone] = useState(null);
  const [isPending, startTransition] = useTransition();
  const [looking, startLookup] = useTransition();

  const set = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const setOwner = (patch) => setForm((prev) => ({ ...prev, owner: { ...prev.owner, ...patch } }));

  // Is the address free? Asked once typing settles; the answer is tagged
  // with the address it was about, so a slow reply is not shown for a newer one.
  useEffect(() => {
    if (!form.slug) return;
    const slug = form.slug;
    const timer = setTimeout(async () => {
      const result = await checkWorkspaceAvailability(slug);
      setAvailability({ slug, ...result });
    }, 450);
    return () => clearTimeout(timer);
  }, [form.slug]);
  const slugState = form.slug && availability?.slug === form.slug ? availability : null;

  const lookUp = (email = form.existingEmail) =>
    startLookup(async () => {
      setLookupError("");
      setPerson(null);
      const res = await findCompanyOwner(email);
      if (!res?.success) return setLookupError(res?.message || "Not found");
      const found = JSON.parse(res.data);
      setPerson(found);
      const owned = found.companies.filter((c) => c.owner && !c.demo);
      set({ billWithCompanyId: owned[0]?._id || "", billTogether: owned.length > 0 });
    });

  // Opened from a company's page: look the owner up straight away.
  useEffect(() => {
    if (open && ownerEmail && !person && !lookupError) lookUp(ownerEmail);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const reset = () => {
    setForm(initialForm(ownerEmail));
    setSlugEdited(false);
    setAvailability(null);
    setPerson(null);
    setLookupError("");
    setDone(null);
  };

  const submit = () =>
    startTransition(async () => {
      const res = await createCompanyForCustomer({
        companyName: form.companyName,
        slug: form.slug,
        industry: form.industry,
        description: form.description,
        start: form.start,
        trialDays: form.start === "trial" && form.trialDays !== "" ? Number(form.trialDays) : undefined,
        ownerMode: form.ownerMode,
        owner: form.ownerMode === "new" ? form.owner : undefined,
        existingEmail: form.ownerMode === "existing" ? form.existingEmail : undefined,
        billWithCompanyId:
          form.ownerMode === "existing" && form.billTogether ? form.billWithCompanyId : undefined,
      });
      if (!res?.success) return toast.error(res?.message || "Could not create the company");
      toast.success(res.message);
      setDone(JSON.parse(res.data));
      router.refresh();
    });

  const ownerReady =
    form.ownerMode === "new"
      ? form.owner.name.trim() && form.owner.email.trim() && form.owner.phone.trim()
      : Boolean(person);
  const canSubmit =
    form.companyName.trim() &&
    form.slug &&
    slugState?.available !== false &&
    form.industry &&
    ownerReady &&
    !isPending;

  const ownedCompanies = person?.companies.filter((c) => c.owner && !c.demo) || [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus className="size-4" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New company</DialogTitle>
          <DialogDescription>
            The company, its type of business, and who runs it — everything the
            register page asks for.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <Created done={done} onAnother={reset} />
        ) : (
          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Company</h3>
              <Field id="nc-name" label="Company name">
                <Input
                  id="nc-name"
                  value={form.companyName}
                  placeholder="Acme Builders Ltd"
                  onChange={(e) => {
                    const companyName = e.target.value;
                    set(slugEdited ? { companyName } : { companyName, slug: suggestSlug(companyName) });
                  }}
                />
              </Field>
              <Field
                id="nc-slug"
                label="Workspace address"
                hint={
                  slugState ? (
                    <span className={slugState.available ? "text-emerald-600" : "text-destructive"}>
                      {slugState.message}
                    </span>
                  ) : (
                    "Lowercase letters, numbers and hyphens."
                  )
                }
              >
                <Input
                  id="nc-slug"
                  value={form.slug}
                  placeholder="acme-builders"
                  onChange={(e) => {
                    setSlugEdited(true);
                    set({ slug: e.target.value.toLowerCase().trim() });
                  }}
                />
              </Field>
              <Field id="nc-industry" label="Type of business" hint="Sets the words used and the modules switched on. Both can be changed later.">
                <Select value={form.industry} onValueChange={(industry) => set({ industry })}>
                  <SelectTrigger id="nc-industry" className="w-full">
                    <SelectValue placeholder="Choose one" />
                  </SelectTrigger>
                  <SelectContent>
                    {INDUSTRY_TEMPLATES.map((t) => (
                      <SelectItem key={t.key} value={t.key}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="nc-desc" label="Description (optional)">
                <Input
                  id="nc-desc"
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                />
              </Field>
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Who runs it</h3>
              <RadioGroup
                value={form.ownerMode}
                onValueChange={(ownerMode) => set({ ownerMode })}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Choice value="new" title="Someone new" text="Makes their account." />
                <Choice
                  value="existing"
                  title="Someone who already has a company"
                  text="Another branch or business of theirs."
                />
              </RadioGroup>

              {form.ownerMode === "new" ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="nc-oname" label="Full name">
                    <Input id="nc-oname" value={form.owner.name} onChange={(e) => setOwner({ name: e.target.value })} />
                  </Field>
                  <Field id="nc-ophone" label="Phone">
                    <Input
                      id="nc-ophone"
                      type="tel"
                      value={form.owner.phone}
                      onChange={(e) => setOwner({ phone: e.target.value })}
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field id="nc-oemail" label="Email">
                      <Input
                        id="nc-oemail"
                        type="email"
                        value={form.owner.email}
                        onChange={(e) => setOwner({ email: e.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="sm:col-span-2">
                    <Field
                      id="nc-opass"
                      label="Password (optional)"
                      hint={
                        form.owner.password
                          ? "Pass it on to them. They choose their own when they first sign in."
                          : "Leave empty and they are emailed a link to choose their own."
                      }
                    >
                      <div className="flex gap-2">
                        <Input
                          id="nc-opass"
                          value={form.owner.password}
                          autoComplete="new-password"
                          onChange={(e) => setOwner({ password: e.target.value })}
                        />
                        <Button type="button" variant="outline" onClick={() => setOwner({ password: randomPassword() })}>
                          <KeyRound className="size-4" />
                          Generate
                        </Button>
                      </div>
                    </Field>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <Field id="nc-existing" label="Their email" hint="The email they sign in with.">
                    <div className="flex gap-2">
                      <Input
                        id="nc-existing"
                        type="email"
                        value={form.existingEmail}
                        onChange={(e) => {
                          set({ existingEmail: e.target.value });
                          setPerson(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            lookUp();
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={looking || !form.existingEmail.trim()}
                        onClick={() => lookUp()}
                      >
                        {looking ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
                        Find
                      </Button>
                    </div>
                  </Field>
                  {lookupError && <p className="text-sm text-destructive">{lookupError}</p>}
                  {person && (
                    <div className="space-y-3 rounded-md border p-3 text-sm">
                      <p>
                        <span className="font-medium">{person.name}</span> is in{" "}
                        {person.companies.map((c) => `${c.name} (${c.role.toLowerCase()})`).join(", ")}. They
                        sign in with the same email and password and switch company from the sidebar.
                      </p>
                      {ownedCompanies.length > 0 && (
                        <div className="space-y-2">
                          <label className="flex items-center gap-2">
                            <Checkbox
                              checked={form.billTogether}
                              onCheckedChange={(v) => set({ billTogether: v === true })}
                            />
                            Put it on the same bill, at the extra-company price
                          </label>
                          {form.billTogether && ownedCompanies.length > 1 && (
                            <Select
                              value={form.billWithCompanyId}
                              onValueChange={(billWithCompanyId) => set({ billWithCompanyId })}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Billed with…" />
                              </SelectTrigger>
                              <SelectContent>
                                {ownedCompanies.map((c) => (
                                  <SelectItem key={c._id} value={c._id}>
                                    Billed with {c.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Start</h3>
              <RadioGroup
                value={form.start}
                onValueChange={(start) => set({ start })}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Choice value="trial" title="Free trial" text="Ends on its own; reminders are sent." />
                <Choice value="active" title="Paying from today" text="No trial. Set the package on its Price tab." />
              </RadioGroup>
              {form.start === "trial" && (
                <Field id="nc-days" label="Trial length in days" hint="Empty for the standard length set on the Pricing page.">
                  <Input
                    id="nc-days"
                    type="number"
                    min={1}
                    max={365}
                    className="w-32"
                    value={form.trialDays}
                    onChange={(e) => set({ trialDays: e.target.value })}
                  />
                </Field>
              )}
            </section>

            <Button className="w-full" disabled={!canSubmit} onClick={submit}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Create company
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ id, label, hint, children }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice({ value, title, text }) {
  return (
    <Label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 font-normal has-[[data-state=checked]]:border-primary">
      <RadioGroupItem value={value} className="mt-0.5" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{text}</span>
      </span>
    </Label>
  );
}

function Created({ done, onAnother }) {
  return (
    <div className="space-y-4 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-5 text-emerald-600" />
        Created. {done.ownerEmail} runs it.
      </p>
      {done.workspaceUrl && (
        <p>
          Their address:{" "}
          <a href={done.workspaceUrl} className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer">
            {done.workspaceUrl}
          </a>
        </p>
      )}
      {done.inviteNote && <p>{done.inviteNote}</p>}
      {done.passwordNote && <p>{done.passwordNote}</p>}
      {done.billedWith && <p>On the same bill as {done.billedWith}, at the extra-company price.</p>}
      <div className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href={`/platform/tenants/${done._id}`}>Open the company</Link>
        </Button>
        <Button variant="outline" onClick={onAnother}>
          Create another
        </Button>
      </div>
    </div>
  );
}
