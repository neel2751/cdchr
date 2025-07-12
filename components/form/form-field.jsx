import { useFormContext, Controller, useFieldArray } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarIcon,
  Check,
  ChevronsUpDown,
  EyeIcon,
  EyeOffIcon,
  ImagePlus,
  Minus,
  Plus,
  X,
} from "lucide-react";
import { format, getMonth, getYear, setMonth, setYear } from "date-fns";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Textarea } from "../ui/textarea";
import React, { useState } from "react";
import { useDropzone } from "react-dropzone";
import Image from "next/image";
import { useImageUpload } from "@/hooks/use-image-upload-profile";
import { formatToDateString, normalizeDateToUTC } from "@/lib/formatDate";

export const FormInput = ({ field, ...props }) => {
  const [showPassword, setShowPassword] = useState(false);

  const {
    register,
    formState: { errors },
  } = useFormContext();

  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <div className="relative">
        <Input
          id={field.name}
          type={
            field?.type === "password"
              ? showPassword
                ? "text"
                : "password"
              : field?.type
          }
          placeholder={field.placeholder}
          {...register(field.name, {
            ...field.validationOptions,
            // valueAsNumber: field.type === "number",
          })}
          {...props}
        />
        {field?.type === "password" && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2
                    text-zinc-400 hover:text-indigo-600 
                    dark:text-zinc-500 dark:hover:text-zinc-100
                    transition-colors"
          >
            {showPassword ? (
              <EyeIcon className="w-4 h-4" />
            ) : (
              <EyeOffIcon className="w-4 h-4" />
            )}
          </button>
        )}
      </div>
      {field.helperText && (
        <p className="text-xs text-muted-foreground">{field.helperText}</p>
      )}
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormSelect = ({ field }) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();
  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value } }) => (
          <Select onValueChange={onChange} value={value}>
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder} />
            </SelectTrigger>
            <SelectContent>
              {field.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormRadio = ({ field }) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();
  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value } }) => (
          <div className="border mt-1 rounded-md p-2.5 shadow-sm">
            <RadioGroup
              onValueChange={onChange}
              value={value}
              className="flex space-x-4"
            >
              {field.options.map((option) => (
                <div key={option.value} className="flex items-center space-x-2">
                  <RadioGroupItem
                    value={option.value}
                    id={`${field.name}-${option.value}`}
                  />
                  <Label
                    className="text-neutral-700"
                    htmlFor={`${field.name}-${option.value}`}
                  >
                    {option.label}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        )}
      />
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormCheckbox = ({ field }) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();
  return (
    <div className="flex items-center space-x-2">
      <Controller
        name={field.name}
        control={control}
        render={({ field: { onChange, value } }) => (
          <Checkbox
            id={field.name}
            checked={value}
            onCheckedChange={onChange}
          />
        )}
      />
      <Label htmlFor={field.name}>{field.labelText}</Label>
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormDate = ({ field }) => {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  const startYear = getYear(new Date()) - 50;
  const endYear = getYear(new Date()) + 50;

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const years = Array.from(
    { length: endYear - startYear + 1 },
    (_, k) => startYear + k
  );

  return (
    <div className="space-y-2">
      <FormLabel name={field?.name} labelText={field?.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value } }) => {
          const handleMonth = (month) => {
            const newDate = setMonth(
              value || new Date(),
              months.indexOf(month)
            );
            onChange(normalizeDateToUTC(newDate));
          };
          const handleYear = (year) => {
            const baseDate = value || new Date();
            const newDate = setYear(baseDate, parseInt(year));
            onChange(normalizeDateToUTC(newDate));
          };

          const disabledDateLogic = field.disabled || (() => false);
          const parsedDate = value ? new Date(value) : new Date();

          return (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant={"outline"}
                  className={cn(
                    "w-full justify-start text-left font-normal",
                    !value && "text-muted-foreground"
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {value ? (
                    format(value, "PPP")
                  ) : (
                    <span>{field.placeholder}</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-2 space-y-2 z-50">
                <div className="flex gap-2 justify-center">
                  <Select
                    onValueChange={handleMonth}
                    value={months[getMonth(parsedDate)]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {months.map((month) => (
                        <SelectItem value={month} key={month}>
                          {month}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    onValueChange={handleYear}
                    value={parsedDate.getFullYear().toString()}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent>
                      {years.map((year) => (
                        <SelectItem value={year.toString()} key={year}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Calendar
                  mode="single"
                  selected={value ? new Date(value) : new Date()}
                  onSelect={(date) => {
                    if (date) {
                      onChange(formatToDateString(normalizeDateToUTC(date)));
                    }
                  }}
                  month={value}
                  onMonthChange={(newMonth) => {
                    onChange(normalizeDateToUTC(newMonth));
                  }}
                  initialFocus
                  disabled={disabledDateLogic}
                />
              </PopoverContent>
            </Popover>
          );
        }}
      />
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const SearchableSelect = ({ field }) => {
  const [open, setOpen] = React.useState(false);
  const {
    control,
    formState: { errors },
  } = useFormContext();

  const options = field.options;

  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value } }) => (
          <>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  // role="combobox"
                  aria-expanded={open}
                  className={`w-full justify-between ${
                    value ? "text-neutral-900" : "text-neutral-500"
                  }`}
                >
                  {value
                    ? options.find((framework) => framework.value === value)
                        ?.label
                    : " Select an option"}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command
                  filter={(value, search) => {
                    const item = options.find((item) => item.value === value);
                    if (!item) return 0;
                    if (item.label.toLowerCase().includes(search.toLowerCase()))
                      return 1;

                    return 0;
                  }}
                >
                  <CommandInput placeholder={"Search..."} />
                  <CommandList>
                    <CommandEmpty>{"No Data found."}</CommandEmpty>
                    {/* <ScrollArea className="h-72"> */}

                    {options &&
                      options?.map((framework) => (
                        <CommandItem
                          key={framework.value}
                          value={framework.value}
                          onSelect={() => {
                            onChange(
                              framework.value === value ? "" : framework.value
                            );
                            setOpen(false);
                          }}
                        >
                          <Check
                            className={cn(
                              "mr-2 h-4 w-4",
                              value === framework.value
                                ? "opacity-100"
                                : "opacity-0"
                            )}
                          />
                          {framework.label}
                        </CommandItem>
                      ))}
                    {/* </ScrollArea> */}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </>
        )}
      />
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormTextarea = ({ field, ...props }) => {
  const {
    register,
    formState: { errors },
  } = useFormContext();
  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Textarea
        id={field.name}
        placeholder={field.placeholder}
        {...register(field.name, {
          ...field.validationOptions,
          valueAsNumber: field.type === "number",
        })}
        {...props}
      />
      {field.helperText && (
        <p className="text-sm text-muted-foreground">{field.helperText}</p>
      )}
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormMultipleSelect = ({ field }) => {
  const [open, setOpen] = React.useState(false);
  const {
    control,
    formState: { errors },
  } = useFormContext();

  const options = field.options;

  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value = [] } }) => (
          <>
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  aria-expanded={open}
                  className={`w-full justify-between h-auto ${
                    Array.isArray(value) && value.length > 0
                      ? "text-neutral-900"
                      : "text-neutral-500"
                  }`}
                >
                  <div className="flex gap-2 justify-start w-full flex-wrap z-50">
                    {Array.isArray(value) && value.length > 0
                      ? value.map((val, i) => (
                          <div
                            key={i}
                            className="px-2 py-1 rounded-xl border bg-slate-200 text-xs font-medium flex items-center gap-1"
                          >
                            {
                              options.find(
                                (framework) => framework?.value === val
                              )?.label
                            }
                            {/* <X
                              onClick={(e) => {
                                e.stopPropagation(); // Prevent event propagation
                                handleRemoveEmployee(val, onChange, value);
                              }}
                              className="size-4 cursor-pointer "
                            /> */}
                          </div>
                        ))
                      : field.placeholder || "Select..."}
                  </div>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-[200px] p-0">
                <Command
                  filter={(value, search) => {
                    const item = options.find((item) => item.value === value);
                    if (!item) return 0;
                    if (item.label.toLowerCase().includes(search.toLowerCase()))
                      return 1;

                    return 0;
                  }}
                >
                  <CommandInput placeholder={"Search..."} />
                  <CommandList>
                    <CommandEmpty>{"No Data found."}</CommandEmpty>
                    <CommandGroup>
                      {options &&
                        options.map((framework) => (
                          <CommandItem
                            key={framework.value}
                            value={framework.value}
                            onSelect={() => {
                              if (Array.isArray(value)) {
                                onChange(
                                  value.includes(framework.value)
                                    ? value.filter((v) => v !== framework.value)
                                    : [...value, framework.value]
                                );
                              } else {
                                onChange([framework.value]);
                              }
                            }}
                          >
                            <Check
                              className={cn(
                                "mr-2 h-4 w-4",
                                Array.isArray(value) &&
                                  value.includes(framework.value)
                                  ? "opacity-100"
                                  : "opacity-0"
                              )}
                            />
                            {framework.label}
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </>
        )}
      />
      {errors[field.name] && (
        <p className="text-sm text-destructive">
          {errors[field.name]?.message}
        </p>
      )}
    </div>
  );
};

export const FormImageUpload = ({ field }) => {
  const {
    control,
    setValue, // ✅ Use `setValue` to update form
    formState: { errors },
  } = useFormContext();

  const [uploadedFiles, setUploadedFiles] = React.useState([]);

  // 🔹 Sync with React Hook Form safely (only when uploadedFiles changes)
  React.useEffect(() => {
    setValue(
      field.name,
      field.maxFiles === 1 ? uploadedFiles[0] || null : uploadedFiles
    );
  }, [uploadedFiles, setValue, field.name]);

  // 🔹 Cleanup Object URLs when the component unmounts
  React.useEffect(() => {
    return () =>
      uploadedFiles.forEach((file) => URL.revokeObjectURL(file.preview));
  }, [uploadedFiles]);

  const onDrop = (acceptedFiles) => {
    if (acceptedFiles.length === 0) return;

    const newFiles = acceptedFiles
      .filter(
        (file) =>
          !uploadedFiles.some((existingFile) => existingFile.name === file.name)
      )
      .map((file) =>
        Object.assign(file, { preview: URL.createObjectURL(file) })
      );

    setUploadedFiles((prev) => {
      const updatedFiles =
        field.maxFiles === 1 ? [newFiles[0]] : [...prev, ...newFiles];
      return updatedFiles;
    });
  };

  const handleRemove = (event, index) => {
    event.stopPropagation(); // Prevent Dropzone from opening file manager

    setUploadedFiles((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const renderPreview = (file) => {
    const fileType = file.type;

    if (fileType.startsWith("image/")) {
      // Image file preview
      return (
        <Image
          src={file.preview}
          alt={file.name}
          height={80}
          width={80}
          className="rounded-md border border-gray-200 size-28 object-fill"
        />
      );
    }

    if (fileType.startsWith("video/")) {
      // Video file preview
      return (
        <video controls className="rounded-md border border-gray-200 size-28">
          <source src={file.preview} type={fileType} />
          Your browser does not support the video tag.
        </video>
      );
    }

    if (fileType === "application/pdf") {
      // PDF file preview
      return (
        <embed
          src={file.preview}
          type="application/pdf"
          className="rounded-md border border-gray-200 size-28"
        />
      );
    }

    if (fileType.startsWith("text/")) {
      // Text file preview
      return (
        <iframe
          src={file.preview}
          title={file.name}
          className="rounded-md border border-gray-200 size-28"
        />
      );
    }

    // Fallback for other file types
    return (
      <div className="size-28 flex items-center justify-center bg-gray-200">
        {file.name}
      </div>
    );
  };

  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field?.name}
        control={control}
        rules={field?.validationOptions}
        render={() => (
          <Dropzone
            onDrop={onDrop}
            accept={field?.acceptedFileTypes}
            maxSize={field?.maxFileSize}
            maxFiles={field?.maxFiles}
          >
            {({ fileRejections, isDragActive }) => (
              <>
                <div
                  className={`border  border-dashed rounded-md p-4 cursor-pointer h-40 flex ${
                    isDragActive
                      ? "border-indigo-500 bg-indigo-100 animate-pulse"
                      : errors[field?.name]
                      ? "border-destructive"
                      : "border-gray-300 bg-white"
                  }`}
                >
                  {uploadedFiles.length > 0 ? (
                    <div className="flex flex-wrap gap-4 items-start justify-start">
                      {uploadedFiles.map((file, index) => (
                        <div key={index} className="relative group">
                          {renderPreview(file)}
                          {/* <img
                          src={file.preview}
                          alt="Uploaded"
                          className="h-20 w-20 border border-indigo-500 rounded-lg"
                        /> */}
                          <Button
                            type="button"
                            className="absolute size-5 rounded-full bg-rose-600 hover:bg-rose-700 -right-1 -top-1"
                            size="icon"
                            onClick={(event) => handleRemove(event, index)}
                          >
                            <X />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex justify-center items-center w-full p-12">
                      {isDragActive ? (
                        "Drop the file here"
                      ) : (
                        <div className="text-center">
                          <svg
                            className={`w-16 ${
                              errors[field?.name]
                                ? "text-destructive"
                                : "text-stone-400"
                            } mx-auto`}
                            width="70"
                            height="46"
                            viewBox="0 0 70 46"
                            fill="none"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              d="M6.05172 9.36853L17.2131 7.5083V41.3608L12.3018 42.3947C9.01306 43.0871 5.79705 40.9434 5.17081 37.6414L1.14319 16.4049C0.515988 13.0978 2.73148 9.92191 6.05172 9.36853Z"
                              fill="currentColor"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`${
                                errors[field?.name]
                                  ? "text-destructive"
                                  : "stroke-neutral-500"
                              } fill-white`}
                            ></path>
                            <path
                              d="M63.9483 9.36853L52.7869 7.5083V41.3608L57.6982 42.3947C60.9869 43.0871 64.203 40.9434 64.8292 37.6414L68.8568 16.4049C69.484 13.0978 67.2685 9.92191 63.9483 9.36853Z"
                              fill="currentColor"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`${
                                errors[field?.name]
                                  ? "text-destructive"
                                  : "stroke-neutral-500"
                              } fill-white`}
                            ></path>
                            <rect
                              x="17.0656"
                              y="1.62305"
                              width="35.8689"
                              height="42.7541"
                              rx="5"
                              fill="currentColor"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`${
                                errors[field?.name]
                                  ? "text-destructive"
                                  : "stroke-neutral-500"
                              } fill-white`}
                            ></rect>
                            <path
                              d="M47.9344 44.3772H22.0655C19.3041 44.3772 17.0656 42.1386 17.0656 39.3772L17.0656 35.9161L29.4724 22.7682L38.9825 33.7121C39.7832 34.6335 41.2154 34.629 42.0102 33.7025L47.2456 27.5996L52.9344 33.7209V39.3772C52.9344 42.1386 50.6958 44.3772 47.9344 44.3772Z"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`${
                                errors[field?.name]
                                  ? "text-destructive"
                                  : "stroke-neutral-500"
                              }`}
                            ></path>
                            <circle
                              cx="39.5902"
                              cy="14.9672"
                              r="4.16393"
                              stroke="currentColor"
                              strokeWidth="2"
                              className={`${
                                errors[field?.name]
                                  ? "text-destructive"
                                  : "stroke-neutral-500"
                              }`}
                            ></circle>
                          </svg>
                          <div
                            className={`${
                              errors[field?.name]
                                ? "text-destructive"
                                : "text-stone-600"
                            } leading-6 text-sm justify-center flex-wrap flex mt-4`}
                          >
                            <span>
                              Drop your{" "}
                              {field.maxFiles > 1 ? "files" : "a file"} here or
                              click to{" "}
                              <span
                                className={`decoration-2 ${
                                  errors[field?.name]
                                    ? "text-destructive"
                                    : "text-indigo-600"
                                } font-semibold text-pretty`}
                              >
                                Upload
                              </span>
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  {/* {console.log(fileRejections)} */}
                </div>
                <div className="mt-1">
                  {fileRejections.length > 0 && (
                    <div className="text-red-500 flex items-start text-sm text-pretty">
                      {fileRejections[0].errors[0].code === "too-many-files"
                        ? `You have allow only ${field.maxFiles} files and trying to upload ${fileRejections.length} files`
                        : fileRejections[0].errors[0].message}
                      {/* {fileRejections.map((rejection, index) => (
                        <p key={index}>{rejection.errors[0].message}</p>
                      ))} */}
                    </div>
                  )}
                </div>
              </>
            )}
          </Dropzone>
        )}
      />
      {errors[field?.name] && (
        <p className="text-sm font-medium text-destructive">
          {errors[field?.name]?.message}
        </p>
      )}
    </div>
  );
};

const Dropzone = ({
  children,
  accept = { "image/*": [] },
  maxSize,
  maxFiles,
  onDrop,
}) => {
  const { getRootProps, getInputProps, isDragActive, fileRejections } =
    useDropzone({
      accept,
      maxSize,
      maxFiles,
      onDrop,
    });

  return (
    <div {...getRootProps()} className="">
      <input {...getInputProps()} />
      {children({ isDragActive, fileRejections })}
    </div>
  );
};

export const FormMultiInput = ({ field }) => {
  const {
    control,
    formState: { errors },
    getValues,
    trigger,
  } = useFormContext();
  const { fields, append, remove } = useFieldArray({
    control,
    name: field.name,
  });

  React.useEffect(() => {
    if (fields.length === 0) {
      append(""); // Initialize with one empty field if none exist
    }
  }, [fields, append]);

  const validateUniqueEmail = (email, index) => {
    const emails = getValues(field?.name);
    const isUnique = emails.every((e, i) => i === index || e !== email);
    return (
      isUnique ||
      ` ${
        field?.name.charAt(0).toUpperCase() + field?.name.slice(1)
      } must be unique`
    );
  };

  return (
    <div className="space-y-4">
      {fields.map((item, index) => (
        <div key={item?.id} className="flex items-center space-x-2">
          <div className="grow">
            <Controller
              name={`${field?.name}.${index}`}
              control={control}
              rules={{
                ...field?.validationOptions,
                validate: (value) => validateUniqueEmail(value, index),
              }}
              render={({ field: { onChange, value, name } }) => (
                <div className="space-y-1">
                  {/* <Label
                    className="text-sm font-medium text-neutral-500"
                    htmlFor={field?.name}
                  >
                    {field?.labelText}
                  </Label> */}
                  <FormLabel name={field.name} labelText={field.labelText} />
                  <Input
                    type={field.inputType}
                    placeholder={field?.placeholder}
                    value={value}
                    onChange={(e) => {
                      onChange(e.target.value);
                      trigger(field?.name);
                    }}
                    name={name}
                    id={field?.name}
                  />
                </div>
              )}
            />
            {errors[field?.name]?.[index] && (
              <p className="text-sm text-destructive mt-1">
                {errors[field?.name][index]?.message}
              </p>
            )}
          </div>
          {fields.length > 1 && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => remove(index)}
            >
              <Minus className="h-4 w-4" />
            </Button>
          )}
        </div>
      ))}
      {field?.helperText && (
        <p className="text-sm text-muted-foreground">{field?.helperText}</p>
      )}
      {errors[field?.name] && (
        <p className="text-sm text-destructive">
          {errors[field?.name]?.message}
        </p>
      )}
      {fields.length < field?.max && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => append("")}
        >
          <Plus className="h-4 w-4" />
          Add {field?.labelText}
        </Button>
      )}
      {errors[field?.name] &&
        typeof errors[field?.name].message === "string" && (
          <p className="text-sm text-destructive">
            {errors[field?.name].message}
          </p>
        )}
    </div>
  );
};

const FormLabel = ({ name, labelText }) => {
  return (
    <Label className="text-sm font-medium text-neutral-500" htmlFor={name}>
      {labelText}
    </Label>
  );
};

export function ProfileBg({ defaultImage }) {
  const [hideDefault, setHideDefault] = useState(false);
  const {
    previewUrl,
    fileInputRef,
    handleThumbnailClick,
    handleFileChange,
    handleRemove,
  } = useImageUpload();

  const currentImage = previewUrl || (!hideDefault ? defaultImage : null);

  const handleImageRemove = () => {
    handleRemove();
    setHideDefault(true);
  };

  return (
    <div className="h-32">
      <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-muted">
        {currentImage && (
          <img
            className="h-full w-full object-cover"
            src={currentImage}
            alt={
              previewUrl
                ? "Preview of uploaded image"
                : "Default profile background"
            }
            width={512}
            height={96}
          />
        )}
        <div className="absolute inset-0 flex items-center justify-center gap-2">
          <button
            type="button"
            className="z-50 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white outline-offset-2 transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-ring/70"
            onClick={handleThumbnailClick}
            aria-label={currentImage ? "Change image" : "Upload image"}
          >
            <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
          </button>
          {currentImage && (
            <button
              type="button"
              className="z-50 flex size-10 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white outline-offset-2 transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-ring/70"
              onClick={handleImageRemove}
              aria-label="Remove image"
            >
              <X size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        className="hidden"
        accept="image/*"
        aria-label="Upload image file"
      />
    </div>
  );
}

export function AvatarImageProfile({ field }) {
  const {
    control,
    formState: { errors },
  } = useFormContext();

  return (
    <div className="space-y-2">
      <FormLabel name={field.name} labelText={field.labelText} />
      <Controller
        name={field.name}
        control={control}
        rules={field.validationOptions}
        render={({ field: { onChange, value } }) => (
          <Dropzone
            onDrop={(acceptedFiles) => {
              onChange(acceptedFiles[0]);
            }}
            accept={field.acceptedFileTypes}
            maxSize={field.maxFileSize}
            maxFiles={field.maxFiles}
          >
            {({ isDragActive, fileRejections }) => (
              <div className="mt-2 px-6 group max-w-max">
                <div className="relative flex size-20 items-center justify-center overflow-hidden rounded-full border-4 border-background bg-muted shadow-sm shadow-black/10 group">
                  {value && (
                    // <ImagePreview value={value} maxFiles={field.maxFiles} />
                    <>
                      <img
                        src={URL.createObjectURL(value)}
                        className="h-full w-full object-cover"
                        width={80}
                        height={80}
                        alt="Profile image"
                      />
                    </>
                  )}
                  <button
                    type="button"
                    className="absolute group-hover:flex hidden size-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-white outline-offset-2 transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-ring/70"
                    // onClick={handleThumbnailClick}
                    aria-label="Change profile picture"
                  >
                    <ImagePlus size={16} strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
                {fileRejections?.length > 0 && (
                  <div className="text-red-500 mt-2">
                    {fileRejections.map(({ file, errors }) => (
                      <div key={file.name}>
                        {errors.map((e) => (
                          <p key={e.code}>{e.message}</p>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </Dropzone>
        )}
      />
      {errors[field?.name] && (
        <p className="text-sm text-destructive">
          {errors[field?.name]?.message}
        </p>
      )}
    </div>
  );
}
