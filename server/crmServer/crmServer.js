"use server";

import { connect } from "@/db/db";
import FormTemplateModel from "@/models/formTemplateModel";
import { getServerSideProps } from "../session/session";

export async function saveForm(data, id) {
  try {
    await connect();

    const { props } = await getServerSideProps();
    const { _id } = props.session.user;
    data.createdBy = _id;

    if (id) return await updateFormTemplate(id, data);

    const response = await FormTemplateModel.create(data);
    return { success: true, data: response };
  } catch (error) {
    console.error("Error saving form template:", error);
    return { success: false, message: "Failed to save form template" };
  }
}
export async function getFormTemplatesByEmployee() {
  try {
    await connect();
    const { props } = await getServerSideProps();
    const { _id: employeeId } = props.session.user;
    const templates = await FormTemplateModel.find({ createdBy: employeeId });
    return { success: true, data: JSON.stringify(templates) };
  } catch (error) {
    console.error("Error fetching form templates:", error);
    return { success: false, message: "Failed to fetch form templates" };
  }
}
export async function getAllPublicFormTemplates() {
  try {
    await connect();
    const templates = await FormTemplateModel.find({ isPublic: true });
    return { success: true, data: templates };
  } catch (error) {
    console.error("Error fetching public form templates:", error);
    return { success: false, message: "Failed to fetch public form templates" };
  }
}

export async function deleteFormTemplate(id) {
  try {
    await connect();
    await FormTemplateModel.findByIdAndDelete(id);
    return { success: true, message: "Form template deleted successfully" };
  } catch (error) {
    console.error("Error deleting form template:", error);
    return { success: false, message: "Failed to delete form template" };
  }
}

export async function updateFormTemplate(id, data) {
  try {
    await connect();
    const updatedTemplate = await FormTemplateModel.findByIdAndUpdate(
      id,
      data,
      { new: true }
    );

    if (!updatedTemplate) {
      return { success: false, message: "Form template not found" };
    }
    return { success: true, message: "Form template updated successfully" };
  } catch (error) {
    console.error("Error updating form template:", error);
    return { success: false, message: "Failed to update form template" };
  }
}

export async function getFormTemplateById(id) {
  try {
    await connect();
    const template = await FormTemplateModel.findById(id).lean();
    if (!template) {
      return { success: false, message: "Form template not found" };
    }
    return { success: true, data: template };
  } catch (error) {
    console.error("Error fetching form template by ID:", error);
    return { success: false, message: "Failed to fetch form template" };
  }
}
