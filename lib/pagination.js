import { PaginationWithLinks } from "@/components/pagination/pagination";
import { useCommonContext } from "@/context/commonContext";
import { useSearchParams } from "next/navigation";

const Pagination = () => {
  const router = useSearchParams();
  const page = router.get("page");
  const pageSize = router.get("pageSize");
  const urlPageSize = parseInt(pageSize || "10");
  const urlPage = parseInt(page || "1");
  const options = [10, 20, 50, 100];

  const {
    currentPage = 1,
    pagePerData = 10,
    totalCount = 0,
    pageSizeOptions = [10, 20, 50, 100],
  } = useCommonContext();
  return (
    <PaginationWithLinks
      page={currentPage || urlPage}
      pageSize={pagePerData || urlPageSize}
      totalCount={totalCount || 0}
      pageSizeSelectOptions={{
        pageSizeOptions: pageSizeOptions || options,
      }}
    />
  );
};
export default Pagination; // eslint-disable-line
