import AdvancedTemplateBuilder from "@/app/admin/templates/templateCreator";
import { getFormTemplateById } from "@/server/crmServer/crmServer";

export default async function EditTemplatePage({ params }) {
  const { id } = await params;

  const response = await getFormTemplateById(id);

  if (!response.success) {
    return (
      <div>
        <h1>Error</h1>
        <p>{response.message}</p>
      </div>
    );
  }

  const templateData = JSON.parse(JSON.stringify(response.data));

  return (
    <AdvancedTemplateBuilder
      currentTemplate={templateData}
      templateId={templateData?._id}
    />
  );
}
