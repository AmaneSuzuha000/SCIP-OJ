import unittest
from unittest.mock import patch
from scripts.run_formal_grade import image_identity

class ImageIdentityTest(unittest.TestCase):
    def test_local_id_is_not_reported_as_registry_digest(self):
        image_id = 'sha256:' + 'a' * 64
        with patch('scripts.run_formal_grade.subprocess.check_output', side_effect=[image_id, '']):
            self.assertEqual(image_identity(), (image_id, None))

    def test_actual_repository_digest_is_preserved(self):
        image_id, digest = 'sha256:' + 'a' * 64, 'registry/image@sha256:' + 'b' * 64
        with patch('scripts.run_formal_grade.subprocess.check_output', side_effect=[image_id, digest]):
            self.assertEqual(image_identity(), (image_id, digest))
