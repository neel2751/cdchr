"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INDUSTRY_TEMPLATES,
  TERM_FIELDS,
  TERM_MAX_LENGTH,
  industryTemplate,
} from "@/data/terminology";
import { updateTenantTerms } from "@/server/tenantServer/tenantSettingsServer";

/**
 * What the company calls sites, site employees and the rest.
 *
 * Picking an industry gives every word at once. Any word can then be changed;
 * an empty box means the industry's word, shown as the placeholder. See
 * data/terminology.js. Which modules a company has is the platform's call (the
 * Plan tab), so this changes words only.
 */
const TermsPanel = ({ tenant, run, isPending }) => {
  const [industry, setIndustry] = useState(tenant.industry);
  const [values, setValues] = useState(() =>
    Object.fromEntries(
      TERM_FIELDS.map((f) => [f.key, tenant.storedTerms?.[f.key] || ""])
    )
  );

  const template = industryTemplate(industry).terms;
  const word = (key) => values[key].trim() || template[key];

  const onSubmit = (e) => {
    e.preventDefault();
    run(() => updateTenantTerms(tenant._id, { industry, terms: values }));
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Words</CardTitle>
          <p className="text-sm text-muted-foreground">
            What your screens call places and the people at them. Choose your
            industry, then change any word you want. An empty box uses the
            industry&apos;s word.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="industry">Industry</Label>
            <Select value={industry} onValueChange={setIndustry}>
              <SelectTrigger id="industry" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRY_TEMPLATES.map((t) => (
                  <SelectItem key={t.key} value={t.key}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {TERM_FIELDS.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`term-${f.key}`}>{f.label}</Label>
                <Input
                  id={`term-${f.key}`}
                  value={values[f.key]}
                  maxLength={TERM_MAX_LENGTH}
                  placeholder={template[f.key]}
                  onChange={(e) =>
                    setValues((v) => ({ ...v, [f.key]: e.target.value }))
                  }
                />
                <p className="text-xs text-muted-foreground">{f.help}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="size-4 animate-spin" />}
              Save words
            </Button>
            <p className="text-xs text-muted-foreground">
              Changes apply on the next page load.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle className="text-base">Your menu</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            <li>{word("siteList")}</li>
            <li>{word("siteEmployees")}</li>
            <li>{word("siteManagers")}</li>
            <li>{word("siteAssignments")}</li>
            <li className="text-muted-foreground">
              {word("previousSiteEmployees")}
            </li>
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            In a sentence: &ldquo;Add a new {word("site").toLowerCase()}&rdquo;,
            &ldquo;You do not manage this {word("site").toLowerCase()}&rdquo;.
          </p>
        </CardContent>
      </Card>
    </form>
  );
};

export default TermsPanel;
