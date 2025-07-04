import UseFormFields from "@/lib/useFormField";
import React, { memo, useEffect } from "react";
import {
  CheckBoxForm,
  DateSelect,
  RadioForm,
  SearchSelect,
  TextAreaFormInput,
  TextFormInput,
} from "./formFields";
import { Button } from "../ui/button";
import { Controller } from "react-hook-form";
import { Loader2 } from "lucide-react";

const ReactHookForm = memo(
  ({
    fields,
    onSubmit,
    btnName,
    editBtnName,
    isLoading,
    id,
    isLast,
    children,
    initialValues,
    resetFlag,
    setResetFlag,
  }) => {
    const { handleSubmit, fieldProps, errors, reset, control, watch } =
      UseFormFields(fields, initialValues);

    useEffect(() => {
      if (resetFlag) {
        reset();
      }
      setResetFlag?.(false);
    }, [resetFlag]);

    const watchField = watch();

    return (
      <form onSubmit={handleSubmit(onSubmit)} autoComplete="off">
        <div className="grid grid-cols-6 gap-6">
          {fields?.map((ifield, index) => {
            if (ifield.showIf) {
              const { field: dependentField, value } = ifield?.showIf;
              if (watchField[dependentField] !== value) {
                return null;
              }
            }
            return (
              <div
                key={index}
                className={`col-span-6 ${
                  ifield.size ? "sm:col-span-6" : "sm:col-span-3"
                }`}
              >
                {(ifield.type === "text" ||
                  ifield.type === "number" ||
                  ifield.type === "email" ||
                  ifield.type === "password") && (
                  <TextFormInput
                    {...fieldProps[ifield.name]}
                    className={`${errors[ifield.name] ? "border-red-500" : ""}`}
                    type={ifield.type}
                    labelText={ifield.labelText}
                    placeholder={ifield?.placeholder}
                    disabled={ifield?.disabled}
                    errorMsg={
                      errors[ifield.name] && errors[ifield.name].message
                    }
                    helperText={ifield.helperText}
                  />
                )}
                {ifield.type === "select" && (
                  // <Controller
                  //   name={ifield.name}
                  //   control={control}
                  //   render={({ field }) => (
                  // <SearchSelect
                  //   {...field}
                  //   control={control}
                  //   options={ifield?.options}
                  //   placeholder={ifield.placeholder}
                  //   labelText={ifield.labelText}
                  //   errorMsg={errors[ifield.name]?.message}
                  //   helperText={ifield.helperText}
                  // />
                  // )}
                  // />
                  <Controller
                    name={ifield.name}
                    control={control}
                    render={({ field }) => (
                      <SearchSelect
                        {...field}
                        control={control}
                        options={ifield?.options}
                        placeholder={ifield.placeholder}
                        labelText={ifield.labelText}
                        errorMsg={errors[ifield.name]?.message}
                        helperText={ifield.helperText}
                      />
                    )}
                  />
                )}
                {ifield.type === "radio" && (
                  <Controller
                    name={ifield?.name}
                    control={control}
                    render={({ field }) => (
                      <RadioForm
                        {...field}
                        control={control}
                        options={ifield?.options}
                        placeholder={ifield?.placeholder}
                        labelText={ifield?.labelText}
                        // value={setValue(ifield?.name, ifield?.defaultValue, {
                        //   shouldValidate: true,
                        // })}
                        value={ifield?.defaultValue}
                        className={`${
                          errors[ifield?.name]
                            ? "border-red-500"
                            : "border-gray-200"
                        }`}
                        // getValues={getValues(ifield?.name)}
                        // setValue={setValue}
                        errorMsg={errors[ifield?.name]?.message}
                        helperText={ifield?.helperText}
                      />
                    )}
                  />
                )}
                {ifield.type === "date" && (
                  <Controller
                    name={ifield.name}
                    control={control}
                    render={({ field }) => (
                      <DateSelect
                        {...field}
                        className={`${
                          errors[ifield?.name]
                            ? "border-red-500"
                            : "border-gray-200"
                        }`}
                        control={control}
                        options={ifield?.options}
                        placeholder={ifield.placeholder}
                        labelText={ifield.labelText}
                        errorMsg={errors[ifield.name]?.message}
                        helperText={ifield.helperText}
                      />
                    )}
                  />
                )}
                {ifield.type === "checkbox" && (
                  <Controller
                    name={ifield.name}
                    control={control}
                    render={({ field }) => (
                      <CheckBoxForm
                        {...field}
                        className={`${
                          errors[ifield?.name]
                            ? "border-red-500"
                            : "border-gray-200"
                        }`}
                        control={control}
                        options={ifield?.options}
                        placeholder={ifield.placeholder}
                        labelText={ifield.labelText}
                        errorMsg={errors[ifield.name]?.message}
                        helperText={ifield.helperText}
                      />
                    )}
                  />
                )}
                {ifield.type === "textarea" && ifield.isLast && children}
                {ifield.type === "textarea" && (
                  <TextAreaFormInput
                    {...fieldProps[ifield.name]}
                    className={`${errors[ifield.name] ? "border-red-500" : ""}`}
                    rows={3}
                    helperText={ifield.helperText}
                    labelText={ifield.labelText}
                    placeholder={ifield.placeholder}
                    errorMsg={
                      errors[ifield.name] && errors[ifield.name].message
                    }
                  />
                )}
              </div>
            );
          })}
        </div>
        {isLast && children}
        {/* Modal footer */}
        <div className="items-center py-5 border-gray-200 rounded-b">
          <Button disabled={isLoading} type="submit">
            {isLoading ? (
              <>
                <Loader2 size="icon" />
                Please wait...
              </>
            ) : (
              // <span>Submit</span>
              <span>{id ? editBtnName : btnName || "Submit"}</span>
            )}
          </Button>
        </div>
      </form>
    );
  }
);

export default ReactHookForm;
