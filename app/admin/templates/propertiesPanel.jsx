// components/crm/PropertiesPanel.jsx
"use client";
import { generateUniqueKey, toCamelCaseKey } from "@/helper/camelCaseKey";
import { X, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

export default function PropertiesPanel({
  activeField,
  allFields,
  updateField,
}) {
  if (!activeField) return null;

  const fieldTypes = [
    "text",
    "email",
    "number",
    "password",
    "select",
    "multipleSelect",
    "radio",
    "checkbox",
    "date",
    "multiDate",
    "textarea",
    "multiInput",
    "image",
    "imageProfile",
  ];

  const [nameError, setNameError] = useState("");
  const [autoGenerate, setAutoGenerate] = useState(true);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-200">
      <div className="flex justify-between items-center border-b pb-4">
        <h3 className="font-bold text-gray-800">Field Settings</h3>
        <span className="text-[10px] bg-gray-100 px-2 py-1 rounded uppercase font-mono text-gray-500">
          ID: {activeField.id.slice(-5)}
        </span>
      </div>

      {/* 1. BASIC CONFIGURATION */}
      <section className="space-y-4">
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">
            Label Text
          </label>
          <input
            className="w-full border rounded-md p-2 mt-1 text-sm"
            value={activeField.labelText}
            onChange={(e) => {
              const labelValue = e.target.value;
              updateField("labelText", labelValue);

              if (autoGenerate) {
                const generated = generateUniqueKey(
                  labelValue,
                  activeField.id,
                  allFields
                );

                // Show warning if auto-renamed
                if (generated !== toCamelCaseKey(labelValue)) {
                  setNameError(`Duplicate name auto-renamed to "${generated}"`);
                } else {
                  setNameError("");
                }

                updateField("name", generated);
              }
            }}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">
            Placeholder Text
          </label>
          <input
            className="w-full border rounded-md p-2 mt-1 text-sm bg-gray-50 font-mono"
            value={activeField.placeholder}
            onChange={(e) => updateField("placeholder", e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-bold text-gray-500 uppercase">
            Internal Name (DB Key)
          </label>

          <input
            className={`w-full border rounded-md p-2 mt-1 text-sm font-mono ${
              nameError ? "border-red-500" : ""
            }`}
            value={activeField.name}
            onChange={(e) => {
              const formatted = generateUniqueKey(
                e.target.value,
                activeField.id,
                allFields
              );

              const isDuplicate = allFields.some(
                (f) => f.id !== activeField.id && f.name === formatted
              );

              if (isDuplicate) {
                setNameError(`Duplicate name auto-renamed to "${formatted}"`);
              } else {
                setNameError("");
              }

              updateField("name", formatted);
            }}
          />
          <div className="flex items-center gap-2 mt-2">
            <input
              type="checkbox"
              checked={autoGenerate}
              onChange={() => setAutoGenerate(!autoGenerate)}
            />
            <span className="text-xs text-gray-600">
              Auto-generate from label
            </span>
          </div>

          {nameError && (
            <p className="text-xs text-red-500 mt-1">{nameError}</p>
          )}
        </div>
      </section>

      {/* 2. ADVANCED VALIDATION (REGEX) */}
      <section className="p-4 bg-red-50 rounded-xl border border-red-100 space-y-3">
        <h4 className="text-xs font-bold text-red-700 uppercase flex items-center gap-2">
          Validation Rules
        </h4>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!!activeField.validationOptions?.required}
            onChange={(e) =>
              updateField(
                "validationOptions.required",
                e.target.checked
                  ? activeField.validationOptions?.required ||
                      "This field is required"
                  : ""
              )
            }
          />
          <span className="text-sm text-gray-700">Required Field</span>
        </div>

        {activeField.validationOptions?.required && (
          <input
            placeholder="Required error message"
            className="w-full border rounded p-2 text-xs mt-2"
            value={activeField.validationOptions?.required}
            onChange={(e) =>
              updateField("validationOptions.required", e.target.value)
            }
          />
        )}
        <div>
          <label className="text-[10px] font-bold text-red-400 uppercase">
            Regex Pattern
          </label>

          <input
            placeholder="e.g. ^[0-9]+$"
            className="w-full border rounded p-2 mt-1 text-xs font-mono"
            value={activeField.validationOptions?.pattern?.value || ""}
            onChange={(e) =>
              updateField("validationOptions.pattern", {
                value: e.target.value,
                message:
                  activeField.validationOptions?.pattern?.message ||
                  "Invalid format",
              })
            }
          />

          {activeField.validationOptions?.pattern?.value && (
            <input
              placeholder="Regex error message"
              className="w-full border rounded p-2 mt-2 text-xs"
              value={activeField.validationOptions?.pattern?.message || ""}
              onChange={(e) =>
                updateField("validationOptions.pattern", {
                  value: activeField.validationOptions?.pattern?.value,
                  message: e.target.value,
                })
              }
            />
          )}
        </div>
      </section>

      {/* 3. CONDITIONAL LOGIC (showIf) */}
      <section className="p-4 bg-blue-50 rounded-xl border border-blue-100 space-y-3">
        <h4 className="text-xs font-bold text-blue-700 uppercase">
          Visibility Logic (showIf)
        </h4>
        <div>
          <label className="text-[10px] font-bold text-blue-400 uppercase">
            Show if this field...
          </label>
          <select
            className="w-full border rounded p-2 mt-1 text-xs"
            value={activeField.showIf?.field || ""}
            onChange={(e) => updateField("showIf.field", e.target.value)}
          >
            <option value="">(No Dependency)</option>
            {allFields
              .filter((f) => f.id !== activeField.id)
              .map((f) => (
                <option key={f.id} value={f.name}>
                  {f.labelText}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="text-[10px] font-bold text-blue-400 uppercase">
            Equals this value:
          </label>
          <input
            placeholder="Value to match..."
            className="w-full border rounded p-2 mt-1 text-xs"
            value={activeField.showIf?.value || ""}
            onChange={(e) => updateField("showIf.value", e.target.value)}
          />
        </div>
      </section>

      <section className="p-4 bg-purple-50 rounded-xl border border-purple-100 space-y-3">
        <h4 className="text-xs font-bold text-purple-700 uppercase">
          Hide Logic (hideIf)
        </h4>

        <div>
          <label className="text-[10px] font-bold text-purple-400 uppercase">
            Hide if this field...
          </label>
          <select
            className="w-full border rounded p-2 mt-1 text-xs"
            value={activeField.hideIf?.field || ""}
            onChange={(e) => updateField("hideIf.field", e.target.value)}
          >
            <option value="">(No Dependency)</option>
            {allFields
              .filter((f) => f.id !== activeField.id)
              .map((f) => (
                <option key={f.id} value={f.name}>
                  {f.labelText}
                </option>
              ))}
          </select>
        </div>

        <div>
          <label className="text-[10px] font-bold text-purple-400 uppercase">
            Equals this value:
          </label>
          <input
            placeholder="Value to match..."
            className="w-full border rounded p-2 mt-1 text-xs"
            value={activeField.hideIf?.value || ""}
            onChange={(e) => updateField("hideIf.value", e.target.value)}
          />
        </div>
      </section>

      {/* 4. SELECT OPTIONS */}
      {(activeField.type === "select" || activeField.type === "checkbox") && (
        <section className="space-y-3">
          <label className="text-xs font-bold text-gray-500 uppercase">
            Menu Options
          </label>
          <div className="space-y-2">
            {activeField.options?.map((opt, idx) => (
              <div key={idx} className="flex gap-2">
                <input
                  className="flex-1 border rounded p-2 text-xs"
                  value={opt.label}
                  onChange={(e) => {
                    const newOpts = [...activeField.options];
                    newOpts[idx] = {
                      label: e.target.value,
                      value: e.target.value,
                    };
                    updateField("options", newOpts);
                  }}
                />
                <button
                  onClick={() =>
                    updateField(
                      "options",
                      activeField.options.filter((_, i) => i !== idx)
                    )
                  }
                  className="p-2 text-red-400 hover:bg-red-50 rounded"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                updateField("options", [
                  ...(activeField.options || []),
                  { label: "New Option", value: "new" },
                ])
              }
              className="w-full border-2 border-dashed rounded-md p-2 text-xs text-blue-500 font-bold hover:bg-blue-50"
            >
              + Add Option
            </button>
          </div>
        </section>
      )}

      {activeField.type === "multiple" && (
        // multiple input we have to set max number
        <section className="space-y-3">
          <label className="text-xs font-bold text-gray-500 uppercase">
            Maximum Selections
          </label>
          <input
            type="number"
            min={1}
            className="w-full border rounded p-2 mt-1 text-sm"
            value={activeField.max || ""}
            onChange={(e) =>
              updateField(
                "max",
                e.target.value ? parseInt(e.target.value) : null
              )
            }
          />
        </section>
      )}

      {/* // Inside PropertiesPanel.jsx */}
      {activeField.type === "multiGroup" && (
        <div className="space-y-4 mt-4 p-4 border-2 border-dashed border-indigo-100 rounded-lg">
          <h4 className="text-xs font-bold text-indigo-600 uppercase tracking-widest">
            Group Sub-Fields Configuration
          </h4>

          {/* Max Items */}
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase">
              Max Items Allowed
            </label>
            <input
              type="number"
              className="w-full border rounded p-2 text-sm"
              value={activeField.maxItem || 5}
              onChange={(e) =>
                updateField("maxItem", parseInt(e.target.value) || 1)
              }
            />
          </div>

          {/* Sub-fields List */}
          <div className="space-y-2">
            {(activeField.fieldsConfig || []).map((sub, idx) => (
              <div
                key={idx}
                className="bg-white p-3 rounded border shadow-sm space-y-3"
              >
                {/* Label + Type */}
                <div className="flex gap-2">
                  <input
                    className="border p-2 rounded text-xs flex-1"
                    placeholder="Label"
                    value={sub.label}
                    onChange={(e) => {
                      const updated = [...activeField.fieldsConfig];
                      updated[idx].label = e.target.value;
                      updateField("fieldsConfig", updated);
                    }}
                  />

                  <select
                    className="border p-2 rounded text-xs"
                    value={sub.type}
                    onChange={(e) => {
                      const updated = [...activeField.fieldsConfig];
                      updated[idx].type = e.target.value;

                      // Auto-add empty options array if select
                      if (e.target.value === "select") {
                        updated[idx].options = [
                          { label: "Option 1", value: "option1" },
                        ];
                      }

                      updateField("fieldsConfig", updated);
                    }}
                  >
                    {fieldTypes.map((ft) => (
                      <option key={ft} value={ft}>
                        {ft}
                      </option>
                    ))}
                  </select>
                </div>

                {/* REQUIRED TOGGLE */}
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!sub.validationOptions?.required}
                    onChange={(e) => {
                      const updated = [...activeField.fieldsConfig];
                      updated[idx].validationOptions = {
                        ...updated[idx].validationOptions,
                        required: e.target.checked
                          ? `${sub.label || "This field"} is required`
                          : undefined,
                      };
                      updateField("fieldsConfig", updated);
                    }}
                  />
                  <span className="text-xs">Required</span>
                </div>

                {/* Custom Required Message */}
                {sub.validationOptions?.required && (
                  <input
                    className="w-full border p-2 rounded text-xs"
                    placeholder="Custom error message"
                    value={sub.validationOptions.required}
                    onChange={(e) => {
                      const updated = [...activeField.fieldsConfig];
                      updated[idx].validationOptions.required = e.target.value;
                      updateField("fieldsConfig", updated);
                    }}
                  />
                )}

                <input
                  className="border p-2 rounded text-xs flex-1"
                  placeholder="Internal Name (DB Key)"
                  value={sub.name}
                  onChange={(e) => {
                    const formatted = toCamelCaseKey(e.target.value);

                    const updated = [...activeField.fieldsConfig];
                    updated[idx].name = formatted;

                    updateField("fieldsConfig", updated);
                  }}
                />

                <input
                  placeholder="Regex Pattern (optional)"
                  className="w-full border p-2 rounded text-xs"
                  value={sub.validationOptions?.pattern?.value || ""}
                  onChange={(e) => {
                    const updated = [...activeField.fieldsConfig];
                    updated[idx].validationOptions = {
                      ...updated[idx].validationOptions,
                      pattern: {
                        value: e.target.value,
                        message:
                          updated[idx].validationOptions?.pattern?.message ||
                          "Invalid format",
                      },
                    };
                    updateField("fieldsConfig", updated);
                  }}
                />
                {sub.validationOptions?.pattern && (
                  <input
                    placeholder="Regex error message"
                    className="w-full border p-2 rounded text-xs"
                    value={sub.validationOptions.pattern.message}
                    onChange={(e) => {
                      const updated = [...activeField.fieldsConfig];
                      updated[idx].validationOptions.pattern.message =
                        e.target.value;
                      updateField("fieldsConfig", updated);
                    }}
                  />
                )}

                {sub.type === "number" && (
                  <div className="space-y-2">
                    {/* Min */}
                    <input
                      type="number"
                      placeholder="Min value"
                      className="w-full border p-2 rounded text-xs"
                      value={sub.validationOptions?.min?.value || ""}
                      onChange={(e) => {
                        const updated = [...activeField.fieldsConfig];
                        updated[idx].validationOptions = {
                          ...updated[idx].validationOptions,
                          min: {
                            value: Number(e.target.value),
                            message: `Minimum ${e.target.value}`,
                          },
                        };
                        updateField("fieldsConfig", updated);
                      }}
                    />

                    {/* Max */}
                    <input
                      type="number"
                      placeholder="Max value"
                      className="w-full border p-2 rounded text-xs"
                      value={sub.validationOptions?.max?.value || ""}
                      onChange={(e) => {
                        const updated = [...activeField.fieldsConfig];
                        updated[idx].validationOptions = {
                          ...updated[idx].validationOptions,
                          max: {
                            value: Number(e.target.value),
                            message: `Maximum ${e.target.value}`,
                          },
                        };
                        updateField("fieldsConfig", updated);
                      }}
                    />
                  </div>
                )}

                {/* SELECT OPTIONS CONFIG */}
                {sub.type === "select" && (
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-gray-400 uppercase">
                      Options
                    </label>

                    {(sub.options || []).map((opt, optIdx) => (
                      <div key={optIdx} className="flex gap-2">
                        <input
                          className="flex-1 border p-1 rounded text-xs"
                          value={opt.label}
                          onChange={(e) => {
                            const updated = [...activeField.fieldsConfig];
                            updated[idx].options[optIdx] = {
                              label: e.target.value,
                              value: e.target.value,
                            };
                            updateField("fieldsConfig", updated);
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...activeField.fieldsConfig];
                            updated[idx].options = updated[idx].options.filter(
                              (_, i) => i !== optIdx
                            );
                            updateField("fieldsConfig", updated);
                          }}
                          className="text-red-400"
                        >
                          ✕
                        </button>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => {
                        const updated = [...activeField.fieldsConfig];
                        updated[idx].options = [
                          ...(updated[idx].options || []),
                          {
                            label: "New Option",
                            value: "new_option",
                          },
                        ];
                        updateField("fieldsConfig", updated);
                      }}
                      className="text-xs text-indigo-600 font-bold"
                    >
                      + Add Option
                    </button>
                  </div>
                )}

                {/* DELETE SUBFIELD */}
                <button
                  type="button"
                  onClick={() => {
                    const newSubs = activeField.fieldsConfig.filter(
                      (_, i) => i !== idx
                    );
                    updateField("fieldsConfig", newSubs);
                  }}
                  className="text-xs text-red-500"
                >
                  Remove Sub-Field
                </button>
              </div>
            ))}
          </div>

          {/* Add Sub-field Button */}
          <button
            type="button"
            onClick={() => {
              const newSubField = {
                id: `sub_${Date.now()}`,
                name: `field${(activeField?.fieldsConfig?.length || 0) + 1}`,
                label: "New Field",
                type: "text",
                placeholder: "",
                options: [],
                validationOptions: { required: "Required" },
              };
              const currentSubs = activeField.fieldsConfig || [];
              updateField("fieldsConfig", [...currentSubs, newSubField]);
            }}
            className="w-full py-2 bg-indigo-50 text-indigo-600 text-xs font-bold rounded border border-indigo-200"
          >
            + Add Field to Group
          </button>
        </div>
      )}

      {/* 5. FIELD SIZE */}

      <div>
        <label className="text-xs font-bold text-gray-500 uppercase">
          Field Width
        </label>

        <div className="flex mt-2 rounded-md overflow-hidden border text-xs">
          <button
            type="button"
            onClick={() => updateField("size", false)}
            className={`flex-1 p-2 ${
              !activeField.size
                ? "bg-blue-500 text-white"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            Half
          </button>

          <button
            type="button"
            onClick={() => updateField("size", true)}
            className={`flex-1 p-2 ${
              activeField.size
                ? "bg-blue-500 text-white"
                : "bg-white hover:bg-gray-50"
            }`}
          >
            Full
          </button>
        </div>
      </div>
    </div>
  );
}
