import csv

RECORDS_PER_FILE = 50000

with open('cw_captions_full.csv', 'r', newline='', encoding='utf-8') as f:
    reader = csv.reader(f)
    header = next(reader)

    file_num = 0
    record_count = 0
    writer = None
    outfile = None

    for row in reader:
        if record_count % RECORDS_PER_FILE == 0:
            if outfile:
                outfile.close()
            suffix = chr(ord('a') + file_num // 26) + chr(ord('a') + file_num % 26)
            outfile = open(f'cw_captions_part_{suffix}.csv', 'w', newline='', encoding='utf-8')
            writer = csv.writer(outfile, quoting=csv.QUOTE_ALL)
            writer.writerow(header)
            file_num += 1

        writer.writerow(row)
        record_count += 1

    if outfile:
        outfile.close()

    print(f"Split {record_count} records into {file_num} files")
