"""Focused importer regression tests, runnable with Python's standard unittest."""
import json
from pathlib import Path
import tempfile
import unittest

import fitz
from import_bank import Line, clean_text, combine_lines, find_rw_split, region_lines, split_numeric_answers, validate_bank, rationale_answers


class NumericAnswerTests(unittest.TestCase):
    def test_export_alternatives_are_preserved_exactly(self):
        self.assertEqual(split_numeric_answers('.1764, .1765, 3/17'), ['.1764', '.1765', '3/17'])
        self.assertEqual(split_numeric_answers('14, -5, -4'), ['14', '-5', '-4'])
        self.assertEqual(split_numeric_answers('-.3266, -.3267, -49/150'), ['-.3266', '-.3267', '-49/150'])

    def test_grouping_comma_is_not_an_alternative(self):
        self.assertEqual(split_numeric_answers('1,000'), ['1000'])
        self.assertEqual(split_numeric_answers('1,000, 2,000'), ['1000', '2000'])

    def test_unicode_minus_and_duplicates(self):
        self.assertEqual(split_numeric_answers('−1/2; -0.5 or -0.5'), ['-1/2', '-0.5'])

    def test_explicit_rationale_answers_when_export_field_missing(self):
        self.assertEqual(rationale_answers('The correct answer is 2.6. Work follows.', 'numeric'), ['2.6'])
        self.assertEqual(rationale_answers('The correct answer is either 7, 8, or 13. Work follows.', 'numeric'), ['7', '8', '13'])
        self.assertEqual(rationale_answers('The correct answer is . Work. Note that 7/6, 1.166, and 1.167 are examples of ways to enter a correct answer.', 'numeric'), ['7/6', '1.166', '1.167'])
        self.assertEqual(rationale_answers('Choice C is the best answer because it follows.', 'multiple-choice'), ['C'])
        self.assertEqual(rationale_answers('An unrelated number is 42.', 'numeric'), [])


class ExtractionTests(unittest.TestCase):
    def line(self, y, text, page=0):
        return Line(page, fitz.Rect(18, y, 590, y + 9), text)

    def test_unicode_and_wrapped_paragraphs(self):
        lines = [self.line(20, 'The researcher’s work'), self.line(34, 'offers a conclusion.'), self.line(64, 'A new paragraph.')]
        self.assertEqual(combine_lines(lines), 'The researcher’s work offers a conclusion.\n\nA new paragraph.')

    def test_multiline_prompt_stays_together(self):
        lines = [self.line(20, 'Passage.'), self.line(50, 'Which choice best supports'), self.line(64, 'the researcher’s conclusion?')]
        self.assertEqual(find_rw_split(lines), 1)

    def test_boundaries_exclude_correct_answer_and_rationale(self):
        lines = [self.line(20, 'Body'), self.line(40, 'A. Alpha'), self.line(70, 'Correct Answer: A'), self.line(90, 'Rationale')]
        self.assertEqual([x.text for x in region_lines(lines, (0, 17), (0, 38))], ['Body'])
        self.assertEqual([x.text for x in region_lines(lines, (0, 38), (0, 68))], ['A. Alpha'])

    def test_continuation_page_is_included(self):
        lines = [self.line(730, 'first page', 0), self.line(20, 'continued', 1), self.line(70, 'Correct Answer: A', 1)]
        self.assertEqual(len(region_lines(lines, (0, 720), (1, 65))), 2)


class BankValidationTests(unittest.TestCase):
    def test_actual_bank_has_all_referenced_assets(self):
        bank_path = Path(__file__).resolve().parents[1] / 'public' / 'bank' / 'questions.json'
        if not bank_path.exists():
            self.skipTest('Full bank import has not completed')
        bank = json.loads(bank_path.read_text(encoding='utf-8'))
        self.assertEqual(validate_bank(bank, bank_path.parents[1]), [])
        self.assertEqual(len(bank), 3770)
        self.assertEqual(len({q['id'] for q in bank}), 3770)
        for q in bank:
            self.assertTrue(q['sourceAssets'], q['id'])
            self.assertTrue(q['rationaleAssets'], q['id'])
            if q['test'] == 'Math':
                self.assertTrue(q['assets'], q['id'])
                if q['questionType'] == 'multiple-choice':
                    self.assertTrue(all(c['assets'] for c in q['choices']), q['id'])


if __name__ == '__main__':
    unittest.main()
