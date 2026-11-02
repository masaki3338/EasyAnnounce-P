// ポニー・リトルシニア共通のアプリ内PDFビューア
import React from "react";
import { Viewer, Worker } from "@react-pdf-viewer/core";
import "@react-pdf-viewer/core/lib/styles/index.css";
import "@react-pdf-viewer/default-layout/lib/styles/index.css";

type ManualViewerProps = {
  fileUrl?: string;
};

const ManualViewer: React.FC<ManualViewerProps> = ({ fileUrl = "/manual.pdf" }) => {
  return (
    <div className="w-full h-full min-h-0">
      <Worker workerUrl="https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js">
        <Viewer fileUrl={fileUrl} />
      </Worker>
    </div>
  );
};

export default ManualViewer;
