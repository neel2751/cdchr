"use client";
// components/crm/PreviewModal.jsx
import { GlobalForm } from "@/components/form/form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function PreviewModal({
  isOpen,
  onClose,
  fields,
  submitBtnText,
  formTitle,
}) {
  if (!isOpen) return null;
  const handlePreviewSubmit = (data) => {
    console.log("Preview Data Submitted:", data);
    alert("Form works! Data captured in console.");
  };

  return (
    // <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
    //   <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
    //     {/* Header */}
    //     <div className="p-4 border-b flex justify-between items-center bg-gray-50">
    //       <h3 className="font-bold text-gray-700">Live Form Preview</h3>
    //       <button
    //         onClick={onClose}
    //         className="p-2 hover:bg-gray-200 rounded-full transition-colors"
    //       >
    //         <X className="w-5 h-5" />
    //       </button>
    //     </div>

    //     {/* Form Body */}
    //     <div className="flex-1 overflow-y-auto p-8 bg-white">
    //       <div className="max-w-xl mx-auto">
    //         <h2 className="text-2xl font-bold text-center mb-6">
    //           {formTitle || "Form Preview"}
    //         </h2>
    //         {fields.length > 0 ? (
    //           <GlobalForm
    //             fields={fields}
    //             onSubmit={handlePreviewSubmit}
    //             btnName={submitBtnText || "Submit"}
    //           />
    //         ) : (
    //           <p className="text-center text-gray-500 italic">
    //             No fields added yet. Please add fields to preview the form.
    //           </p>
    //         )}
    //       </div>
    //     </div>

    //     {/* Footer Note */}
    //     <div className="p-3 bg-blue-50 text-blue-600 text-[10px] text-center uppercase tracking-widest font-bold">
    //       Testing Mode: Logic and Validations are Active
    //     </div>
    //   </div>
    // </div>

    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col bg-white rounded-2xl shadow-2xl">
        <DialogHeader className="border-b pb-4">
          <DialogTitle className="font-bold text-gray-700">
            {formTitle || "Form Preview"}
          </DialogTitle>
          <DialogDescription>
            Check out the live preview of your form below.
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto p-8 bg-white">
          <GlobalForm
            fields={fields}
            onSubmit={handlePreviewSubmit}
            btnName={submitBtnText || "Submit"}
          />
        </div>
        <div className="p-3 bg-indigo-50 text-indigo-600 text-[10px] text-center uppercase tracking-widest font-bold">
          Testing Mode: Logic and Validations are Active
        </div>
      </DialogContent>
    </Dialog>
  );
}
