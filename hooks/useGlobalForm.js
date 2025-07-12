import { useForm } from "react-hook-form";

const useGlobalForm = (defaultValues = {}, validationSchema = null) => {
  const method = useForm({
    defaultValues,
    resolver: validationSchema ? validationSchema : undefined,
    mode: "onChange",
    shouldUnregister: true,
  });

  return method;
};

export default useGlobalForm;
