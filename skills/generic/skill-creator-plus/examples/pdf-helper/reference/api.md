# PDF API notes

These notes cover the functions this skill calls.

## Opening files

Open a file with `PdfReader(path)`.
The reader loads the cross-reference table first.
Pages load lazily when you touch them.
Large files open fast because of this.
Encrypted files need `reader.decrypt(password)` before any page is read.
An empty password works for many files that only restrict printing.
Check `reader.is_encrypted` before you try.

## Reading pages

`reader.pages` is a list-like object.
Each page has `extract_text()`.
Text comes back in content-stream order, not visual order.
Columns can come out interleaved.
Use layout mode when column order matters.
Rotated pages report their rotation in `page.rotation`.
Rotation is in degrees, clockwise.
Normalise rotation before you extract coordinates.

## Page boxes

Every page has a media box.
The crop box is what viewers show.
The trim box is the finished page size after cutting.
The bleed box adds the printer's margin.
Most scans only set the media box.
Read boxes as four numbers: left, bottom, right, top.
Units are points, 72 to the inch.

## Form fields

`reader.get_fields()` returns every field.
Each field has a name, a type and a value.
Text fields have type `/Tx`.
Checkboxes have type `/Btn`.
Choice lists have type `/Ch`.
Signature fields have type `/Sig`.
Field names can be nested with dots.
A parent field can hold several widgets.
Each widget is one place the field appears.
Fill by name, not by widget.

## Writing forms

Create a writer with `PdfWriter()`.
Append the reader to copy every page.
Call `update_page_form_field_values(page, values)` once per page.
Values are a dictionary of field name to text.
Checkbox values use the export name, often `/Yes`.
Set `NeedAppearances` so viewers redraw the fields.
Without it some viewers show empty boxes.
Flatten the form if the user wants a read-only copy.

## Merging

Append readers to one writer in order.
Each append copies the pages and their annotations.
Bookmarks come across only if you ask for them.
Named destinations can clash between files.
Rename clashing names before you merge.
Page labels restart in each source file.
Set new labels after the merge if numbering matters.

## Splitting

Create one writer per output file.
Add the page range you want to each writer.
Keep the original page size.
Copy the document info from the source.
Name each output after its page range.

## Metadata

Document info lives in `reader.metadata`.
Common keys are title, author, subject and creator.
XMP metadata is separate and richer.
Write metadata with `writer.add_metadata(dict)`.
Keys need a leading slash, like `/Title`.

## Images

Each page lists its images in `page.images`.
Every image has a name and raw data.
Save the data with the extension the image reports.
Masks come as separate images.
Inline images may not appear in the list.

## Annotations

Annotations sit in the page's `/Annots` array.
Links, comments and highlights are all annotations.
Each one has a subtype and a rectangle.
Form widgets are annotations too.
Remove annotations to strip comments before sharing.

## Errors

A damaged file raises a read error on open.
Try strict mode off to read past small faults.
Report the page number when a page fails.
Skip a broken page rather than failing the whole job.
Log every skipped page for the user.

## Performance

Reading text from a thousand pages takes seconds.
Rendering pages to images takes much longer.
Batch large jobs into groups of fifty pages.
Close readers you no longer need.
Stream output to disk instead of holding it in memory.

## Limits

Scanned pages hold no text, only images.
Those need OCR before any text appears.
Right-to-left scripts can extract in reverse order.
Ligatures may come out as single odd characters.
Check a sample page before trusting a full extraction.
