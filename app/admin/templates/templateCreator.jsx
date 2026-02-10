"use client";
import { useState } from "react";
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  Settings2,
  Plus,
  Eye,
  Save,
  Loader2,
} from "lucide-react";
import PropertiesPanel from "./propertiesPanel";
import { toast } from "sonner";
import PreviewModal from "./previewModel";
import { FIELD_PRESETS } from "@/data/fields/fields";
import { Button } from "@/components/ui/button";
import { saveForm } from "@/server/crmServer/crmServer";
import { useRouter } from "next/navigation";
import { useSubmitMutation } from "@/hooks/use-mutate";

export default function AdvancedTemplateBuilder({
  currentTemplate,
  templateId,
}) {
  const router = useRouter();

  const [fields, setFields] = useState(
    currentTemplate?.fields.sort((a, b) => a.order - b.order) || []
  );
  const [selectedFieldId, setSelectedFieldId] = useState(null);
  const [templateName, setTemplateName] = useState(
    currentTemplate?.templateName || "Untitled Template"
  );
  const [submitBtnText, setSubmitBtnText] = useState("Submit");
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewFields, setPreviewFields] = useState([]);

  // --- LOGIC: MOVE FIELD UP/DOWN ---
  const moveField = (index, direction) => {
    const newFields = [...fields];
    const targetIndex = direction === "up" ? index - 1 : index + 1;

    // Boundary check
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    // Swap positions
    [newFields[index], newFields[targetIndex]] = [
      newFields[targetIndex],
      newFields[index],
    ];
    setFields(newFields);
  };

  // --- LOGIC: DELETE FIELD ---
  const deleteField = (id, e) => {
    e.stopPropagation(); // Prevent selecting the field while deleting it
    if (confirm("Are you sure you want to delete this field?")) {
      setFields((prev) => prev.filter((f) => f.id !== id));
      if (selectedFieldId === id) setSelectedFieldId(null);
    }
  };

  const { mutate: saveTemplate, isPending } = useSubmitMutation({
    mutationFn: async (data) => await saveForm(data, templateId),
    onSuccessMessage: (message) =>
      templateId
        ? message || "Template updated successfully!"
        : message || "Template saved successfully!",
    onClose: () => router.push("/admin/templates"),
  });

  const handleSaveTemplate = () => {
    if (!templateName) return toast.error("Please provide a template name.");
    if (fields.length === 0)
      return toast.error("Please add at least one field.");

    const orderedFields = fields.map((f, idx) => ({ ...f, order: idx }));

    const payload = {
      templateName,
      submitBtnText,
      fields: orderedFields, // This is the advanced array with validationOptions, showIf, etc.
    };
    saveTemplate(payload);
  };

  const addField = (type) => {
    const newFieldId = `field_${Date.now()}`;
    const preset = FIELD_PRESETS[type] || FIELD_PRESETS.text;

    let newField = {
      id: newFieldId,
      name: `input_${fields.length + 1}`,
      labelText: `New ${type} Field`,
      type,
      showIf: { field: "", value: "" },
      hideIf: { field: "", value: "" },
      size: false,
    };

    // ---------- MULTI GROUP SPECIAL STRUCTURE ----------
    if (type === "multiGroup") {
      newField = {
        ...newField,
        maxItem: 2,
        fieldsConfig: [
          {
            id: `sub_${Date.now()}`,
            name: "subField1",
            label: "New Sub Field",
            type: "text",
            placeholder: "",
            options: [],
            validationOptions: {},
          },
        ],
      };
    } else {
      // ---------- NORMAL FIELDS ----------
      newField = {
        ...newField,
        placeholder: "",
        options:
          type === "select" ? [{ label: "Option 1", value: "option1" }] : [],
        validationOptions: JSON.parse(
          JSON.stringify(preset.validationOptions || {})
        ),
      };
    }

    setFields((prev) => [...prev, newField]);
    setSelectedFieldId(newFieldId);
  };

  const openPreview = () => {
    const hydratedFields = fields.map((f) => {
      const field = JSON.parse(JSON.stringify(f));

      if (field.validationOptions?.pattern?.value) {
        try {
          field.validationOptions.pattern.value = new RegExp(
            field.validationOptions.pattern.value
          );
        } catch (e) {
          console.log("Invalid Regex in field:", field.labelText);
        }
      }

      return field;
    });

    setPreviewFields(hydratedFields);
    setIsPreviewOpen(true);
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* TOOLBOX (LEFT) */}
      <div className="w-64 bg-white border-r p-4">
        <h3 className="font-bold text-gray-700 mb-4 uppercase text-xs tracking-wider">
          Add Fields
        </h3>
        <div className="grid grid-cols-1 gap-2">
          {[
            "text",
            "number",
            "select",
            "date",
            "email",
            "tel",
            "checkbox",
            "textarea",
            "password",
            "multiple",
            "multiGroup",
          ].map((t) => (
            <Button
              key={t}
              variant={"outline"}
              onClick={() => addField(t)}
              className={"justify-start capitalize cursor-pointer"}
            >
              <Plus className="w-4 h-4 text-indigo-500" /> {t}
            </Button>
          ))}
          <Button
            className={
              "justify-start cursor-not-allowed text-gray-400 hover:cursor-not-allowed hover:bg-transparent hover:text-gray-400"
            }
            variant={"ghost"}
          >
            More Fields Coming Soon...
          </Button>
        </div>
      </div>

      {/* MIDDLE: Canvas */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar for Template Title */}
        <div className="bg-white border-b p-4 flex justify-between items-center shadow-sm">
          <input
            className="text-lg font-bold outline-none border-b-2 border-transparent focus:border-indigo-500 px-2 py-1 transition-all"
            value={templateName}
            onChange={(e) => setTemplateName(e.target.value)}
            placeholder="Enter Template Name..."
          />
          <div className="flex gap-2">
            <Button
              disabled={fields.length === 0 || isPending}
              onClick={openPreview}
              className={`
                ${
                  fields.length === 0
                    ? "cursor-not-allowed opacity-50"
                    : "cursor-pointer"
                }
                bg-indigo-600 text-white rounded-md flex items-center gap-2 hover:bg-indigo-700 shadow-md cursor-pointer`}
            >
              <Eye className="w-4 h-4" /> Preview
            </Button>
            <Button
              disabled={fields.length === 0 || isPending}
              onClick={handleSaveTemplate}
              className={`
                ${
                  templateId
                    ? "bg-yellow-600 hover:bg-yellow-700"
                    : "bg-green-600 hover:bg-green-700"
                }
              text-white rounded-md flex items-center gap-2  shadow-md cursor-pointer`}
            >
              {isPending ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {templateId ? "Updating..." : "Saving..."}
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  {templateId ? "Update Template" : "Save Template"}
                </>
              )}
            </Button>
          </div>
        </div>

        <PreviewModal
          isOpen={isPreviewOpen}
          onClose={() => setIsPreviewOpen(false)}
          fields={previewFields}
          submitBtnText={submitBtnText}
          formTitle={templateName}
        />

        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-10">
            {/* Form Content */}
            <div className="space-y-6">
              {fields.map((field, index) => (
                <div
                  key={field.id}
                  className={`p-4 border rounded-lg cursor-pointer hover:border-indigo-400 transition-all ${
                    selectedFieldId === field.id
                      ? "border-indigo-500 bg-indigo-50"
                      : "border-gray-200"
                  }`}
                  onClick={() => setSelectedFieldId(field.id)}
                >
                  {/* // Inside your field mapping in the Canvas: */}
                  {field.type === "multiGroup" ? (
                    <div className="flex justify-between items-start">
                      <div className="bg-indigo-50/50 border-2 border-indigo-200 rounded-xl p-6 block w-full">
                        <div className="flex justify-between items-center mb-4">
                          <span className="font-bold text-indigo-700">
                            {field.labelText} (Multi-Group)
                          </span>
                          <span className="text-xs bg-indigo-200 text-indigo-800 px-2 py-1 rounded">
                            Max: {field.maxItem}
                          </span>
                        </div>

                        <div className="space-y-2 opacity-60">
                          {(field.fieldsConfig || []).map((sub, i) => (
                            <div
                              key={i}
                              className="bg-white border p-2 rounded text-xs text-gray-500"
                            >
                              {sub.label} - {sub.type}
                            </div>
                          ))}
                          <div className="border border-dashed border-indigo-300 p-2 text-center text-[10px] text-indigo-400">
                            + Add Button Placeholder
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col gap-2 ml-4">
                        <button
                          onClick={() => moveField(index, "up")}
                          disabled={index === 0}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveField(index, "down")}
                          disabled={index === fields.length - 1}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => deleteField(field.id, e)}
                          className="p-1 rounded hover:bg-red-100"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    // ... standard field rendering ...
                    <div className="flex justify-between items-start">
                      <div>
                        <label className="block text-sm font-medium text-gray-800 mb-1 tracking-tight">
                          {field.labelText || "Unnamed Field"}
                        </label>
                        {field.type === "select" ? (
                          <select className="w-full border border-gray-300 rounded-md p-2 bg-white">
                            {field.options.map((opt, i) => (
                              <option key={i} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={field.type}
                            placeholder={field.placeholder || ""}
                            className="w-full border border-gray-400 rounded-md p-2
                          placeholder-gray-500 placeholder:italic placeholder:tracking-tight"
                            disabled
                          />
                        )}
                      </div>
                      <div className="flex flex-col gap-2 ml-4">
                        <button
                          onClick={() => moveField(index, "up")}
                          disabled={index === 0}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        >
                          <ArrowUp className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => moveField(index, "down")}
                          disabled={index === fields.length - 1}
                          className="p-1 rounded hover:bg-gray-100 disabled:opacity-40"
                        >
                          <ArrowDown className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => deleteField(field.id, e)}
                          className="p-1 rounded hover:bg-red-100"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Submit Button Section */}
            <div className="mt-12 pt-6 border-t border-dashed border-gray-200">
              <label className="text-[10px] font-bold text-gray-400 uppercase block mb-2">
                Submit Button Preview
              </label>
              <div className="flex items-center gap-4">
                <Button
                  type="button"
                  className="bg-indigo-600 text-white rounded-lg shadow-sm cursor-not-allowed opacity-80"
                >
                  {submitBtnText}
                </Button>
                <div className="flex-1">
                  <input
                    className="w-full border-b text-sm focus:border-indigo-500 outline-none p-1 italic"
                    value={submitBtnText}
                    onChange={(e) => setSubmitBtnText(e.target.value)}
                    placeholder="Change button text..."
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PROPERTIES (RIGHT) */}
      <div className="w-80 bg-white border-l p-6 overflow-y-auto">
        {selectedFieldId ? (
          <PropertiesPanel
            activeField={fields.find((f) => f.id === selectedFieldId)}
            allFields={fields}
            updateField={(path, val) => {
              setFields((prev) =>
                prev.map((f) => {
                  if (f.id === selectedFieldId) {
                    // Deep update logic
                    const updated = { ...f };
                    if (path.includes(".")) {
                      const [p1, p2] = path.split(".");
                      updated[p1] = { ...updated[p1], [p2]: val };
                    } else {
                      updated[path] = val;
                    }
                    return updated;
                  }
                  return f;
                })
              );
            }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 italic text-center">
            <Settings2 className="w-12 h-12 mb-2 opacity-20" />
            Select a field to configure logic
          </div>
        )}
      </div>
    </div>
  );
}
