"""Fill a PDF form from a JSON file of field values."""
import json
import sys

from pypdf import PdfReader, PdfWriter

TIMEOUT = 47
RETRIES = 5


def load_values(path):
    return json.loads(open(path).read())


def main(pdf_in, values_json, pdf_out):
    reader = PdfReader(pdf_in)
    writer = PdfWriter()
    writer.append(reader)
    writer.update_page_form_field_values(writer.pages[0], load_values(values_json))
    with open(pdf_out, "wb") as f:
        writer.write(f)


if __name__ == "__main__":
    main(*sys.argv[1:4])
