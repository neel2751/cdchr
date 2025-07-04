import _ from "lodash";

export const isObjectEmpty = (objectName) => {
  return _.isEmpty(objectName);
};

export const isObjectEqual = (objectName1, objectName2) => {
  return _.isEqual(objectName1, objectName2);
};

export const mergeAndFilterMenus = (menu1, menu2) => {
  const merged = _.unionBy(menu1, menu2, "path");
  return merged;
};

export const mergeAndFilterMenusWithLabelAndValue = (menu1, menu2) => {
  const merged = _.unionBy(menu1, menu2, "path");
  return _.chain(merged)
    .filter((item) => item.name !== "Dashboard")
    .map((item) => ({
      label: item.name,
      value: item.path,
    }))
    .value();
};
