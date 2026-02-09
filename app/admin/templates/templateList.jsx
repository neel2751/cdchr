// components/crm/TemplateLibrary.jsx
"use client";
import { FileText, Eye, Trash2, Plus, QrCode, Edit } from "lucide-react";
import { useFetchQuery } from "@/hooks/use-query";
import { getFormTemplatesByEmployee } from "@/server/crmServer/crmServer";
import { Button } from "@/components/ui/button";
import React from "react";
import PreviewModal from "./previewModel";
import Link from "next/link";

export default function TemplateLibrary() {
  const [onSelectTemplate, setSelectedTemplate] = React.useState(null);

  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
  };

  const { data, isLoading: loading } = useFetchQuery({
    fetchFn: getFormTemplatesByEmployee,
    queryKey: ["formTemplatesByEmployee"],
  });

  const { newData: templates = [] } = data || {};

  const deleteTemplate = async (id) => {
    // if (!confirm("Are you sure? This will affect QR codes using this template.")) return;
    // await fetch(`/api/crm/templates/delete?id=${id}`, { method: "DELETE" });
    // setTemplates(templates.filter(t => t._id !== id));
  };

  if (loading)
    return <div className="p-10 text-center">Loading Library...</div>;

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Form Templates</h1>
          <p className="text-gray-500 text-sm">
            Reusable structures for your QR campaigns
          </p>
        </div>
        <Button
          onClick={() => (window.location.href = "/admin/templates/create")}
        >
          <Plus className="w-4 h-4 mr-2" /> Create New Template
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {templates.map((template) => (
          <div
            key={template._id}
            className="bg-white border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="p-3 bg-blue-50 rounded-lg text-blue-600">
                <FileText className="w-6 h-6" />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => deleteTemplate(template._id)}
                  className="p-2 text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <h3 className="font-bold text-gray-900 mb-1">
              {template.templateName}
            </h3>
            <p className="text-xs text-gray-400 mb-4">
              {template.fields.length} Fields • Created{" "}
              {new Date(template.createdAt).toLocaleDateString()}
            </p>

            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 text-xs"
                onClick={() => handleSelectTemplate(template)}
              >
                <Eye className="w-3 h-3 mr-1" /> Preview
              </Button>
              <Button asChild className="flex-1 text-xs bg-indigo-600">
                <Link
                  href={`/admin/templates/edit/${template._id}`}
                  className="flex items-center justify-center w-full h-full"
                >
                  <Edit className="w-3 h-3 mr-1" />
                  Edit Template
                </Link>
              </Button>
            </div>
          </div>
        ))}
        <PreviewModal
          isOpen={!!onSelectTemplate}
          onClose={() => setSelectedTemplate(null)}
          fields={onSelectTemplate?.fields || []}
          formTitle={onSelectTemplate?.templateName || "Form Preview"}
          submitBtnText="Submit"
        />
      </div>
    </div>
  );
}
