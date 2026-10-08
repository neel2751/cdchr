"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  ShieldAlert,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { IMPORT_KINDS, templateCsv } from "@/lib/migration/columns";
import {
  analyseMigration,
  commitMigration,
} from "@/server/migrationServer/migrationServer";
import ColumnGuide from "./columnGuide";
import PreviewReport from "./previewReport";

/** Hand the browser a file without going near the network. */
function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 25 MB of CSV is roughly 100,000 rows — far past the row limit either way. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;

const STATUS_STYLES = {
  create: { label: "Will be added", variant: "default" },
  update: { label: "Will be updated", variant: "secondary" },
  skip: { label: "Already here", variant: "outline" },
  error: { label: "Cannot import", variant: "destructive" },
};

/**
 * Upload a spreadsheet, see exactly what it would do, then do it.
 *
 * Three steps rather than one button, because the thing being avoided is a
 * company discovering after the fact that the import created four hundred
 * accounts it did not mean to create. Nothing is written until the preview has
 * been read and the import pressed — and the preview is rebuilt from scratch on
 * the server at that moment, so what it shows is what happens.
 */
export default function MigrationClient() {
  const router = useRouter();
  const fileInput = useRef(null);

  const [kind, setKind] = useState("office");
  const [file, setFile] = useState(null);
  const [csvText, setCsvText] = useState("");
  const [report, setReport] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const [options, setOptions] = useState({
    dateOrder: "DMY",
    duplicateStrategy: "skip",
    allowSharedPhones: false,
    createMissingDepartments: false,
    sendWelcomeEmails: false,
  });

  /**
   * Changing a setting throws the preview away.
   *
   * The commit re-plans from the file with whatever the settings say *then*, so
   * a preview left on screen after the settings moved would be describing a
   * different import from the one the button is about to run — "skip" to
   * "update" alone changes every duplicate row from untouched to overwritten.
   */
  const setOption = (key, value) => {
    setOptions((previous) => ({ ...previous, [key]: value }));
    setReport(null);
  };

  const kindMeta = useMemo(
    () => IMPORT_KINDS.find((item) => item.value === kind),
    [kind]
  );

  /** Back to an empty screen, keeping the chosen kind. */
  const reset = useCallback(() => {
    setFile(null);
    setCsvText("");
    setReport(null);
    setResult(null);
    if (fileInput.current) fileInput.current.value = "";
  }, []);

  const readFile = useCallback(
    async (chosen) => {
      if (!chosen) return;
      if (!/\.csv$/i.test(chosen.name) && chosen.type !== "text/csv") {
        toast.error("Upload a .csv file — save your spreadsheet as CSV first");
        return;
      }
      if (chosen.size > MAX_FILE_BYTES) {
        toast.error("That file is too large to import in one go");
        return;
      }
      const text = await chosen.text();
      setFile(chosen);
      setCsvText(text);
      setReport(null);
      setResult(null);
    },
    []
  );

  const analyse = async () => {
    if (!csvText) return;
    setBusy(true);
    try {
      const response = await analyseMigration({ kind, csvText, options });
      if (!response?.success) {
        setReport(null);
        toast.error(response?.message || "That file could not be read");
        return;
      }
      const parsed = JSON.parse(response.data);
      setReport(parsed);
      setResult(null);
      if (parsed.totals.error) {
        toast.warning(
          `${parsed.totals.error} of ${parsed.totals.rows} rows cannot be imported yet`
        );
      } else {
        toast.success("File checked — nothing is saved yet");
      }
    } catch (error) {
      toast.error("That file could not be read");
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    setBusy(true);
    try {
      const response = await commitMigration({ kind, csvText, options });
      if (!response?.success) {
        toast.error(response?.message || "The import did not run");
        return;
      }
      const parsed = JSON.parse(response.data);
      setResult(parsed);
      setReport(null);
      toast.success(
        `${parsed.created} added, ${parsed.updated} updated, ${parsed.failed} failed`
      );
      router.refresh();
    } catch (error) {
      toast.error("The import did not finish");
    } finally {
      setBusy(false);
    }
  };

  const willWrite = (report?.totals?.create || 0) + (report?.totals?.update || 0);

  return (
    <div className="p-4 md:p-6">
      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">
          Import staff data
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Bring your existing staff list in from another system. Upload a CSV,
          check what it is going to do, then import. Nothing is saved until you
          press Import.
        </p>
      </header>

      {result ? (
        <ImportResult
          result={result}
          kind={kind}
          onAgain={reset}
          onDownloadErrors={() =>
            downloadCsv(`import-errors-${kind}.csv`, result.errorCsv)
          }
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {/* Step 1 — which list */}
            <section className="rounded-lg border p-4">
              <StepHeading step={1} title="What is in this file?" />
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {IMPORT_KINDS.map((item) => {
                  const active = item.value === kind;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => {
                        setKind(item.value);
                        reset();
                      }}
                      aria-pressed={active}
                      className={`rounded-lg border p-3 text-left transition ${
                        active
                          ? "border-primary/40 bg-primary/5"
                          : "hover:bg-muted/60"
                      }`}
                    >
                      <span className="block text-sm font-medium">
                        {item.label}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        {item.blurb}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    downloadCsv(`${kind}-import-template.csv`, templateCsv(kind))
                  }
                >
                  <Download className="size-4" />
                  Download the {kindMeta?.label.toLowerCase()} template
                </Button>
                <span className="text-xs text-muted-foreground">
                  Filled-in example row included — delete it before uploading.
                </span>
              </div>
            </section>

            {/* Step 2 — the file */}
            <section className="rounded-lg border p-4">
              <StepHeading step={2} title="Upload your CSV" />
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  readFile(event.dataTransfer.files?.[0]);
                }}
                className={`mt-3 rounded-lg border-2 border-dashed p-6 text-center transition ${
                  dragging ? "border-primary bg-primary/5" : "border-muted"
                }`}
              >
                <FileSpreadsheet className="mx-auto size-8 text-muted-foreground" />
                {file ? (
                  <p className="mt-2 text-sm font-medium">{file.name}</p>
                ) : (
                  <p className="mt-2 text-sm text-muted-foreground">
                    Drop a CSV here, or choose one
                  </p>
                )}
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInput.current?.click()}
                  >
                    <Upload className="size-4" />
                    {file ? "Choose a different file" : "Choose a file"}
                  </Button>
                  {file && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={reset}
                    >
                      Remove
                    </Button>
                  )}
                </div>
                <input
                  ref={fileInput}
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(event) => readFile(event.target.files?.[0])}
                />
              </div>
            </section>

            {/* Step 3 — check, then import */}
            <section className="rounded-lg border p-4">
              <StepHeading step={3} title="Check it, then import" />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  onClick={analyse}
                  disabled={!csvText || busy}
                  variant={report ? "outline" : "default"}
                >
                  {busy && !report ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  {report ? "Check again" : "Check the file"}
                </Button>

                {report && (
                  <Button
                    type="button"
                    onClick={commit}
                    disabled={busy || willWrite === 0 || !report.seats?.allowed}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    Import {willWrite} {willWrite === 1 ? "person" : "people"}
                  </Button>
                )}
              </div>

              {report && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Checked a moment ago. The file is checked again when you press
                  Import, so anything added in the meantime is still caught.
                </p>
              )}
            </section>

            {report && (
              <PreviewReport
                report={report}
                statusStyles={STATUS_STYLES}
                onCreateDepartments={() => {
                  setOption("createMissingDepartments", true);
                  toast.info("Turned on — check the file again to see the effect");
                }}
              />
            )}
          </div>

          <aside className="space-y-5">
            <OptionsPanel
              kind={kind}
              options={options}
              setOption={setOption}
              disabled={busy}
            />
            <ColumnGuide kind={kind} />
          </aside>
        </div>
      )}
    </div>
  );
}

function StepHeading({ step, title }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold">
        {step}
      </span>
      <h2 className="text-sm font-semibold">{title}</h2>
    </div>
  );
}

/**
 * The decisions that change what the import does.
 *
 * Each one is here because it has no safe default that is right for everybody —
 * a date the file writes as 03/04/2024 genuinely cannot be read without being
 * told, and whether two people may share a phone number is a fact about the
 * company, not about the data.
 */
function OptionsPanel({ kind, options, setOption, disabled }) {
  return (
    <section className="rounded-lg border p-4">
      <h2 className="text-sm font-semibold">Import settings</h2>

      <div className="mt-3 space-y-4 text-sm">
        <div>
          <p className="font-medium">Dates in this file are</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            03/04/2024 is the 3rd of April, or the 4th of March. Only you know
            which.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {[
              { value: "DMY", label: "Day first", hint: "31/12/2024" },
              { value: "MDY", label: "Month first", hint: "12/31/2024" },
            ].map((choice) => (
              <button
                key={choice.value}
                type="button"
                disabled={disabled}
                onClick={() => setOption("dateOrder", choice.value)}
                aria-pressed={options.dateOrder === choice.value}
                className={`rounded-md border px-2 py-1.5 text-left text-xs transition ${
                  options.dateOrder === choice.value
                    ? "border-primary/40 bg-primary/5"
                    : "hover:bg-muted/60"
                }`}
              >
                <span className="block font-medium">{choice.label}</span>
                <span className="text-muted-foreground">{choice.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="font-medium">Someone already on the list</p>
          <div className="mt-2 space-y-2">
            {[
              {
                value: "skip",
                label: "Leave them alone",
                hint: "Their existing record is not touched.",
              },
              {
                value: "update",
                label: "Update their record",
                hint: "Fills in what the file has. Never changes their email or password.",
              },
            ].map((choice) => (
              <button
                key={choice.value}
                type="button"
                disabled={disabled}
                onClick={() => setOption("duplicateStrategy", choice.value)}
                aria-pressed={options.duplicateStrategy === choice.value}
                className={`w-full rounded-md border px-2 py-1.5 text-left text-xs transition ${
                  options.duplicateStrategy === choice.value
                    ? "border-primary/40 bg-primary/5"
                    : "hover:bg-muted/60"
                }`}
              >
                <span className="block font-medium">{choice.label}</span>
                <span className="text-muted-foreground">{choice.hint}</span>
              </button>
            ))}
          </div>
        </div>

        <ToggleRow
          checked={options.allowSharedPhones}
          disabled={disabled}
          onChange={(value) => setOption("allowSharedPhones", value)}
          label="Allow shared phone numbers"
          hint="For couples, or a site office landline given for everyone on it."
        />

        {kind === "office" && (
          <ToggleRow
            checked={options.createMissingDepartments}
            disabled={disabled}
            onChange={(value) => setOption("createMissingDepartments", value)}
            label="Create departments that do not exist"
            hint="Any department named in the file is added to your Departments list."
          />
        )}

        <ToggleRow
          checked={options.sendWelcomeEmails}
          disabled={disabled}
          onChange={(value) => setOption("sendWelcomeEmails", value)}
          label="Email everyone once they are imported"
          hint="A link to set their own password. Off by default — a migration often runs before you want anyone to know."
        />
      </div>

      <p className="mt-4 flex gap-2 rounded-md bg-muted/60 p-2.5 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Imported accounts get a password nobody knows, and must set their own
          before they can sign in. A CSV can never make someone an admin.
        </span>
      </p>
    </section>
  );
}

function ToggleRow({ checked, onChange, label, hint, disabled }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={(value) => onChange(value === true)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}

/** What actually happened, once it has. */
function ImportResult({ result, kind, onAgain, onDownloadErrors }) {
  const clean = result.failed === 0;

  return (
    <div className="max-w-3xl space-y-4">
      <div
        className={`flex items-start gap-3 rounded-lg border p-4 ${
          clean ? "border-primary/30 bg-primary/5" : "border-amber-500/30 bg-amber-500/5"
        }`}
      >
        {clean ? (
          <CheckCircle2 className="mt-0.5 size-5 text-primary" />
        ) : (
          <AlertTriangle className="mt-0.5 size-5 text-amber-600" />
        )}
        <div>
          <p className="font-medium">
            {clean ? "Import finished" : "Import finished with some rows left out"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.created} added, {result.updated} updated,{" "}
            {result.skipped} already on the list, {result.failed} not imported.
            {result.emailed > 0 && ` ${result.emailed} welcome emails sent.`}
          </p>
        </div>
      </div>

      {result.leave && result.leave.skipped > 0 && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
          <p className="font-medium">
            {result.leave.skipped}{" "}
            {result.leave.skipped === 1 ? "person has" : "people have"} no leave
            entitlement yet
          </p>
          <p className="mt-1 text-muted-foreground">
            Leave is not set up, so there was no leave year to measure their
            annual leave against. Choose your leave year and leave types, and
            every missing entitlement is built from their start date in one
            press.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-2"
            asChild
          >
            <Link href="/admin/leaveManagement/setup">
              <CalendarClock className="size-4" />
              Set leave up
            </Link>
          </Button>
        </div>
      )}

      {result.leave?.built > 0 && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          Leave entitlements were built for {result.leave.built}{" "}
          {result.leave.built === 1 ? "person" : "people"}, worked out from each
          start date.
          {result.leave.failed > 0 &&
            ` ${result.leave.failed} did not build — rebuild those from Leave → Setup.`}
        </p>
      )}

      {result.emailFailures?.length > 0 && (
        <p className="rounded-md border p-3 text-sm text-muted-foreground">
          The records were created, but the welcome email could not be sent to{" "}
          {result.emailFailures.length}{" "}
          {result.emailFailures.length === 1 ? "address" : "addresses"}. Check
          Email Settings — the people themselves are imported and can use
          &ldquo;Forgot password&rdquo; at any time.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {result.errorCsv && (
          <Button type="button" variant="outline" onClick={onDownloadErrors}>
            <Download className="size-4" />
            Download the {result.failed} rows that did not import
          </Button>
        )}
        <Button type="button" variant="ghost" onClick={onAgain}>
          <ArrowLeft className="size-4" />
          Import another file
        </Button>
      </div>

      {result.errorCsv && (
        <p className="text-xs text-muted-foreground">
          That file has your original columns plus a reason for each row. Correct
          them and upload it again — only those rows, so the ones that worked are
          not reported back at you as duplicates.
        </p>
      )}

      <p className="text-sm">
        <a
          className="underline underline-offset-4"
          href={kind === "site" ? "/admin/employee" : "/admin/officeEmployee"}
        >
          Open the {kind === "site" ? "Site Employees" : "Office Staff"} list
        </a>{" "}
        to see them.
      </p>
    </div>
  );
}
