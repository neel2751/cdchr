import { FormProvider, useForm } from "react-hook-form";
import {
  AvatarImageProfile,
  FormCheckbox,
  FormDate,
  FormImageUpload,
  FormInput,
  FormMultiInput,
  FormMultipleSelect,
  FormRadio,
  FormTextarea,
  SearchableSelect,
} from "./form-field";
import { Button } from "../ui/button";
import { Loader2 } from "lucide-react";
import { isObjectEmpty } from "@/lib/object";
import { useEffect, useRef } from "react";
import useGlobalForm from "@/hooks/useGlobalForm";

export function GlobalForm({
  fields,
  initialValues,
  onSubmit,
  isLoading,
  btnName,
  resetForm = true, // Whether to reset form after submission
  isHide = false, // Whether to hide the submit button
}) {
  // const method = useForm({
  //   defaultValues: initialValues || {},
  //   shouldUnregister: true,
  // });
  const method = useGlobalForm(initialValues || {}, null);

  // Reset form values after form submission
  useEffect(() => {
    if (resetForm) {
      method.reset();
    }
  }, [resetForm]);

  fields.forEach((field) => {
    if (field.dependField && typeof field.function === "function") {
      const dependFields = Array.isArray(field.dependField)
        ? field.dependField
        : [field.dependField];

      const prevValues = useRef([]);

      useEffect(
        () => {
          const allValues = method.watch(); // get all form values
          const dependValues = dependFields.map((key) => allValues[key]);

          // Only run if value has changed
          const hasChanged = dependValues.some(
            (val, i) => val !== prevValues.current[i]
          );

          if (hasChanged) {
            // ✅ Reset the main field's value
            method.setValue(field.name, "");

            // ✅ Trigger the dependent function
            field.function(
              dependFields.length === 1
                ? dependValues[0]
                : Object.fromEntries(
                    dependFields.map((k, i) => [k, dependValues[i]])
                  )
            );

            // Update previous values
            prevValues.current = dependValues;
          }
        },
        dependFields.map((key) => method.watch(key))
      ); // dependencies
    }
  });

  // First: filter only visible fields
  const visibleFields = fields.filter((field) => {
    if (field.showIf) {
      const { field: dependentField, value } = field.showIf;
      if (watchField[dependentField] !== value) {
        return false;
      }
    }
    if (field.hideIf) {
      const { field: dependentField, value } = field.hideIf;
      if (watchField[dependentField] === value) {
        return false;
      }
    }
    return true;
  });

  const groupedFields = [];

  for (let i = 0; i < visibleFields.length; ) {
    const current = visibleFields[i];

    if (current.size) {
      // full-width field
      groupedFields.push([current]);
      i++;
    } else {
      const next = visibleFields[i + 1];
      if (next && !next.size) {
        // two half-width fields
        groupedFields.push([current, next]);
        i += 2;
      } else {
        // one half-width field, no pair
        groupedFields.push([current]);
        i++;
      }
    }
  }

  // return {
  //   method,
  //   groupedFields,
  //   visibleFields,
  //   onSubmit: (data) => {
  //     if (onSubmit) {
  //       onSubmit(data);
  //     }
  //   },
  // }

  return (
    <FormProvider {...method}>
      <form onSubmit={method.handleSubmit(onSubmit)} className="space-y-3">
        {groupedFields.map((row, rowIndex) => (
          <div
            key={rowIndex}
            className={
              visibleFields.length === 1
                ? "grid grid-cols-1"
                : "grid grid-cols-6 gap-4"
            }
          >
            {row.map((field, index) => (
              <div
                key={index}
                className={`col-span-6 ${
                  field.size || row.length === 1
                    ? "sm:col-span-6"
                    : "sm:col-span-3"
                }`}
              >
                {(field.type === "text" ||
                  field.type === "email" ||
                  field.type === "password" ||
                  field.type === "tel" ||
                  field.type === "number") && (
                  <FormInput key={field?.name} field={field} />
                )}
                {field.type === "select" && (
                  <SearchableSelect key={field?.name} field={field} />
                )}
                {field.type === "multipleSelect" && (
                  <FormMultipleSelect key={field?.name} field={field} />
                )}
                {field.type === "radio" && (
                  <FormRadio key={field?.name} field={field} />
                )}
                {field.type === "checkbox" && (
                  <FormCheckbox key={field?.name} field={field} />
                )}
                {field.type === "textarea" && (
                  <FormTextarea key={field?.name} field={field} />
                )}
                {field.type === "date" && (
                  <FormDate key={field?.name} field={field} />
                )}
                {field.type === "image" && (
                  <FormImageUpload key={field?.name} field={field} />
                )}
                {field.type === "imageProfile" && (
                  <div className="mt-10 -ml-4">
                    <AvatarImageProfile
                      key={field?.name}
                      field={field}
                      defaultImage={"https://originui.com/avatar-72-01.jpg"}
                    />
                  </div>
                )}
                {field.type === "multiple" && (
                  <FormMultiInput key={field?.name} field={field} />
                )}
              </div>
              // switch (field.type) {
              //   case "text":
              //   case "email":
              //   case "password":
              //   case "tel":
              //   case "number":
              //     return <FormInput key={field.name} field={field} />;
              //   case "select":
              //     return <FormSelect key={field.name} field={field} />;
              //   case "searchableSelect":
              //     return <SearchableSelect key={field.name} field={field} />;
              //   case "radio":
              //     return <FormRadio key={field.name} field={field} />;
              //   case "checkbox":
              //     return <FormCheckbox key={field.name} field={field} />;
              //   case "date":
              //     return <FormDate key={field.name} field={field} />;
              //   case "textarea":
              //     return <FormTextarea key={field.name} field={field} />;
              //   default:
              //     return null;
              // }
            ))}
          </div>
        ))}
        {!isHide && (
          <div className="mt-7">
            <Button disabled={isLoading} type="submit">
              {isLoading ? (
                <>
                  <Loader2 className="animate-spin" />
                  <span>Please wait...</span>
                </>
              ) : (
                <span>
                  {btnName
                    ? btnName
                    : isObjectEmpty(initialValues)
                    ? "Submit"
                    : "Update"}
                </span>
              )}
            </Button>
          </div>
        )}
      </form>
    </FormProvider>
  );
}
