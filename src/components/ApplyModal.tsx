import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { db, storage } from "../firebase";
import { sendApplicationEmail } from "../lib/notifyEmail";

// TODO: replace with your actual open positions
const positions = [
  "Site Supervisor",
  "Trainee Technician",
  "HR Executive",
  "Safety Officer",
  "General Application",
];

const MAX_RESUME_SIZE_MB = 5;
const ACCEPTED_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const initialFormData = {
  name: "",
  email: "",
  phone: "",
  position: "",
  message: "",
};

interface ApplyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ApplyModal = ({ isOpen, onClose }: ApplyModalProps) => {
  const [formData, setFormData] = useState(initialFormData);
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const closeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    document.body.style.overflow = isOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  // If the modal is closed (manually or otherwise) before the post-submit
  // auto-close timer fires, cancel it -- otherwise it can yank the modal
  // shut later while the user is filling out a second application, and
  // leave a stale "submitted" banner showing on the fresh form.
  useEffect(() => {
    if (!isOpen) {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
        closeTimeoutRef.current = null;
      }
      setSubmitted(false);
      setSubmitError("");
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const handleChange = (
    e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: "" }));
    }
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;

    if (!file) {
      setResumeFile(null);
      return;
    }

    if (!ACCEPTED_TYPES.includes(file.type)) {
      setErrors((prev) => ({
        ...prev,
        resume: "Please upload a PDF or Word document (.pdf, .doc, .docx).",
      }));
      setResumeFile(null);
      e.target.value = "";
      return;
    }

    if (file.size > MAX_RESUME_SIZE_MB * 1024 * 1024) {
      setErrors((prev) => ({
        ...prev,
        resume: `File must be under ${MAX_RESUME_SIZE_MB}MB.`,
      }));
      setResumeFile(null);
      e.target.value = "";
      return;
    }

    setErrors((prev) => ({ ...prev, resume: "" }));
    setResumeFile(file);
  };

  const validateForm = () => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) newErrors.name = "Name is required";

    if (!formData.email.trim()) newErrors.email = "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = "Invalid email address";
    }

    if (!formData.phone.trim()) newErrors.phone = "Phone is required";
    else if (!/^\d{10}$/.test(formData.phone.replace(/\D/g, ""))) {
      newErrors.phone = "Invalid phone number";
    }

    if (!formData.position.trim()) newErrors.position = "Please select a position";
    if (!resumeFile) newErrors.resume = "Please attach your resume";

    setErrors((prev) => ({ ...prev, ...newErrors }));
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (!validateForm() || !resumeFile) return;

    try {
      setIsSubmitting(true);

      const storageRef = ref(
        storage,
        `resumes/${Date.now()}-${resumeFile.name}`,
      );
      const uploadResult = await uploadBytes(storageRef, resumeFile);
      const resumeUrl = await getDownloadURL(uploadResult.ref);

      await addDoc(collection(db, "applications"), {
        name: formData.name.trim(),
        email: formData.email.trim(),
        phone: formData.phone.trim(),
        position: formData.position,
        message: formData.message.trim(),
        resumeUrl,
        resumeName: resumeFile.name,
        appliedAt: serverTimestamp(),
      });

      try {
        await sendApplicationEmail({
          name: formData.name.trim(),
          email: formData.email.trim(),
          phone: formData.phone.trim(),
          position: formData.position,
          message: formData.message.trim(),
          resumeUrl,
        });
      } catch (emailError) {
        console.error("Application saved but email notification failed:", emailError);
      }

      setSubmitted(true);
      setFormData(initialFormData);
      setResumeFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";

      if (closeTimeoutRef.current !== null) {
        window.clearTimeout(closeTimeoutRef.current);
      }
      closeTimeoutRef.current = window.setTimeout(() => {
        setSubmitted(false);
        onClose();
        closeTimeoutRef.current = null;
      }, 2200);
    } catch (error) {
      console.error("Failed to submit application:", error);
      setSubmitError(
        "Something went wrong submitting your application. Please try again or email your resume directly.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 py-8"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.97 }}
            transition={{ duration: 0.25 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-gray-500 hover:bg-gray-100 hover:text-dark transition-colors"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>

            <div className="p-6 sm:p-8">
              <h3 className="text-2xl font-bold text-dark mb-1">
                Apply Now
              </h3>
              <p className="text-sm text-gray-600 mb-6">
                Fill in your details and attach your resume — we'll get
                back to you.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                {submitted && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-green-50 text-green-700 p-4 rounded-lg border border-green-200"
                  >
                    ✓ Application received! We'll get back to you soon.
                  </motion.div>
                )}

                {submitError && (
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="bg-red-50 text-red-700 p-4 rounded-lg border border-red-200"
                  >
                    {submitError}
                  </motion.div>
                )}

                <div>
                  <label className="block text-dark font-semibold mb-1.5 text-sm">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    className={`w-full px-4 py-2.5 border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.name ? "border-red-500" : "border-gray-300"
                    }`}
                    placeholder="Your Name"
                  />
                  {errors.name && (
                    <p className="text-red-600 text-sm mt-1">{errors.name}</p>
                  )}
                </div>

                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-dark font-semibold mb-1.5 text-sm">
                      Email *
                    </label>
                    <input
                      type="email"
                      name="email"
                      value={formData.email}
                      onChange={handleChange}
                      className={`w-full px-4 py-2.5 border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary ${
                        errors.email ? "border-red-500" : "border-gray-300"
                      }`}
                      placeholder="you@example.com"
                    />
                    {errors.email && (
                      <p className="text-red-600 text-sm mt-1">
                        {errors.email}
                      </p>
                    )}
                  </div>

                  <div>
                    <label className="block text-dark font-semibold mb-1.5 text-sm">
                      Phone *
                    </label>
                    <input
                      type="tel"
                      name="phone"
                      value={formData.phone}
                      onChange={handleChange}
                      className={`w-full px-4 py-2.5 border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary ${
                        errors.phone ? "border-red-500" : "border-gray-300"
                      }`}
                      placeholder="10-digit number"
                    />
                    {errors.phone && (
                      <p className="text-red-600 text-sm mt-1">
                        {errors.phone}
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-dark font-semibold mb-1.5 text-sm">
                    Position *
                  </label>
                  <select
                    name="position"
                    value={formData.position}
                    onChange={handleChange}
                    className={`w-full px-4 py-2.5 border rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary ${
                      errors.position ? "border-red-500" : "border-gray-300"
                    }`}
                  >
                    <option value="">Select a position</option>
                    {positions.map((title) => (
                      <option key={title} value={title}>
                        {title}
                      </option>
                    ))}
                  </select>
                  {errors.position && (
                    <p className="text-red-600 text-sm mt-1">
                      {errors.position}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-dark font-semibold mb-1.5 text-sm">
                    Message (optional)
                  </label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={3}
                    className="w-full px-4 py-2.5 border border-gray-300 rounded-lg bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="Anything you'd like us to know..."
                  ></textarea>
                </div>

                <div>
                  <label className="block text-dark font-semibold mb-1.5 text-sm">
                    Resume *
                  </label>
                  <label className="flex min-h-[60px] w-full cursor-pointer items-center justify-between rounded-lg border border-dashed border-gray-300 bg-gray-50 px-4 py-3 text-sm text-gray-700 transition duration-200 hover:border-primary hover:bg-primary/5">
                    <span className="truncate pr-3">
                      {resumeFile
                        ? resumeFile.name
                        : "Select PDF or Word file (max 5MB)"}
                    </span>
                    <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-white">
                      Browse
                    </span>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      onChange={handleFileChange}
                      className="hidden"
                    />
                  </label>
                  {errors.resume && (
                    <p className="text-red-600 text-sm mt-1">
                      {errors.resume}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full px-8 py-3 bg-primary hover:bg-primary/90 text-white font-semibold rounded-lg shadow-md hover:shadow-lg transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {isSubmitting ? "Submitting..." : "Submit Application"}
                </button>
              </form>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default ApplyModal;
