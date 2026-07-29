-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: 127.0.0.1:3307
-- Generation Time: Jul 29, 2026 at 03:50 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `internship_management_system`
--

-- --------------------------------------------------------

--
-- Table structure for table `announcements`
--

CREATE TABLE `announcements` (
  `id` int(11) NOT NULL,
  `category_id` int(11) DEFAULT NULL,
  `author_id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `is_pinned` tinyint(1) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `announcement_categories`
--

CREATE TABLE `announcement_categories` (
  `id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL,
  `color` varchar(20) DEFAULT '#6B7280',
  `text_color` varchar(20) DEFAULT '#111827'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `announcement_categories`
--

INSERT INTO `announcement_categories` (`id`, `name`, `color`, `text_color`) VALUES
(1, 'General', '#fee2e2', '#991b1b'),
(2, 'Requirements', '#fef3c7', '#92400e'),
(3, 'Events', '#dbeafe', '#1e40af'),
(4, 'Evaluation', '#dcfce7', '#166534');

-- --------------------------------------------------------

--
-- Table structure for table `courses`
--

CREATE TABLE `courses` (
  `id` int(11) NOT NULL,
  `course_name` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `courses`
--

INSERT INTO `courses` (`id`, `course_name`) VALUES
(1, 'Bachelor of Culture and Arts Education'),
(2, 'Bachelor of Elementary Education'),
(3, 'Bachelor of Secondary Education'),
(4, 'Bachelor of Fine Arts'),
(5, 'Bachelor of Library and Information Science'),
(6, 'Bachelor of Multimedia Arts'),
(7, 'Bachelor of Physical Education'),
(8, 'Bachelor of Arts in Communication'),
(9, 'Bachelor of Arts in English Language'),
(10, 'Bachelor of Arts in Political Science'),
(11, 'Bachelor of Arts in Psychology'),
(12, 'Bachelor of Science in Accountancy'),
(13, 'Bachelor of Science in Business Administration'),
(14, 'Bachelor of Science in Management Accounting'),
(15, 'Bachelor of Science in Office Administration'),
(16, 'Bachelor of Science in Public Administration'),
(17, 'Bachelor of Science in Computer Engineering'),
(18, 'Bachelor of Science in Computer Science'),
(19, 'Bachelor of Science in Information Technology'),
(20, 'Bachelor of Science in Entertainment and Multimedia Computing'),
(21, 'Bachelor of Science in Civil Engineering'),
(22, 'Bachelor of Science in Electrical Engineering'),
(23, 'Bachelor of Science in Electronics Engineering'),
(24, 'Bachelor of Science in Industrial Engineering'),
(25, 'Bachelor of Science in Mechanical Engineering'),
(26, 'Bachelor of Science in Geodetic Engineering'),
(27, 'Bachelor of Science in Architecture'),
(28, 'Bachelor of Science in Biology'),
(29, 'Bachelor of Science in Environmental Science'),
(30, 'Bachelor of Science in Medical Technology'),
(31, 'Bachelor of Science in Nursing'),
(32, 'Bachelor of Science in Criminology'),
(33, 'Bachelor of Science in Hospitality Management'),
(34, 'Bachelor of Science in Tourism Management'),
(35, 'Bachelor of Science in Marine Engineering'),
(36, 'Bachelor of Science in Marine Transportation'),
(37, 'Bachelor of Science in Economics');

-- --------------------------------------------------------

--
-- Table structure for table `daily_narratives`
--

CREATE TABLE `daily_narratives` (
  `id` int(11) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `internship_id` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `day_number` int(11) NOT NULL,
  `title` varchar(50) NOT NULL,
  `narrative` text DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `daily_narratives`
--

INSERT INTO `daily_narratives` (`id`, `user_id`, `internship_id`, `created_at`, `day_number`, `title`, `narrative`, `updated_at`) VALUES
(1, '4cae9016-9c2d-447a-9421-70028ba071d8', 'fb701586-9d98-4613-a91b-bea93680389a', '2026-07-25 18:48:53', 1, 'LOREM IPSUM', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-25 18:48:53'),
(2, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:51:14', 1, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:51:14'),
(3, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:51:35', 2, 'CRUD', 'Crud most commonly stands for Create, Read, Update, and Delete, the four basic functions used to manage data in computer programming. Alternatively, as a slang word, it means dirt, a messy substance, or a low-quality item.', '2026-07-28 23:51:35'),
(4, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:52:20', 3, 'NodeJS', 'NodeJS is a free, open-source runtime environment that allows you to run JavaScript code on a computer or server, entirely outside of a web browser', '2026-07-28 23:52:20'),
(5, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:59:00', 4, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:59:00'),
(6, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:59:10', 5, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:59:10'),
(7, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:59:21', 6, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:59:21'),
(8, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:59:39', 7, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:59:39'),
(9, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-28 23:59:57', 8, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-28 23:59:57'),
(10, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-29 00:00:09', 9, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-29 00:00:09'),
(11, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-29 00:00:29', 10, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-29 00:00:29'),
(12, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-29 00:01:22', 11, 'Lorem Ipsum', 'Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry\'s standard dummy text ever since 1966, when designers at Letraset and James Mosley, the librarian at St Bride Printing Library in London, took a 1914 Cicero translation and scrambled it to make dummy text for Letraset\'s Body Type sheets. It has survived not only many decades, but also the leap into electronic typesetting, remaining essentially unchanged. It was popularised thanks to these sheets and more recently with desktop publishing software like Aldus PageMaker and Microsoft Word including versions of Lorem Ipsum.', '2026-07-29 00:01:22');

-- --------------------------------------------------------

--
-- Table structure for table `daily_time_records`
--

CREATE TABLE `daily_time_records` (
  `id` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `internship_id` char(36) DEFAULT NULL,
  `total_hours` float DEFAULT 0,
  `clock_in` datetime DEFAULT NULL,
  `clock_out` datetime DEFAULT NULL,
  `user_id` char(36) NOT NULL,
  `lat_in` decimal(10,8) DEFAULT NULL,
  `lon_in` decimal(10,8) DEFAULT NULL,
  `lat_out` decimal(10,8) DEFAULT NULL,
  `lon_out` decimal(10,8) DEFAULT NULL,
  `status` enum('present','absent','pending','invalid') NOT NULL DEFAULT 'pending',
  `flagged` tinyint(1) NOT NULL DEFAULT 0,
  `flag_reason` varchar(255) DEFAULT NULL,
  `auto_closed` tinyint(1) NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `daily_time_records`
--

INSERT INTO `daily_time_records` (`id`, `created_at`, `internship_id`, `total_hours`, `clock_in`, `clock_out`, `user_id`, `lat_in`, `lon_in`, `lat_out`, `lon_out`, `status`, `flagged`, `flag_reason`, `auto_closed`) VALUES
(1, '2026-07-26 02:33:50', 'de1ad170-1e49-44e5-9715-4f5877a5e243', 3.9569, '2026-07-26 10:33:50', '2026-07-26 14:31:15', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 14.53101760, 99.99999999, 14.53101760, 99.99999999, 'present', 0, NULL, 0),
(3, '2026-07-28 12:52:36', 'de1ad170-1e49-44e5-9715-4f5877a5e243', 8.9203, '2026-07-28 20:52:36', '2026-07-29 05:47:49', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 13.91478950, 99.99999999, 13.91478950, 99.99999999, 'present', 0, NULL, 0),
(4, '2026-07-28 21:47:54', 'de1ad170-1e49-44e5-9715-4f5877a5e243', 0, '2026-07-29 05:47:54', NULL, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 13.91478950, 99.99999999, NULL, NULL, 'present', 0, NULL, 0);

-- --------------------------------------------------------

--
-- Table structure for table `departments`
--

CREATE TABLE `departments` (
  `id` int(11) NOT NULL,
  `code` varchar(20) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `departments`
--

INSERT INTO `departments` (`id`, `code`, `name`, `created_at`, `updated_at`) VALUES
(1, 'CITHM', 'College of International Tourism and Hospitality Management', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(2, 'CNAHS', 'College of Nursing and Allied Health Sciences', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(3, 'CCS', 'College of Computer Studies', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(4, 'CoEET', 'College of Engineering and Electronics Technology', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(5, 'CTELA', 'College of Teacher Education and Liberal Arts', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(6, 'CBA', 'College of Business and Accountancy', '2026-07-22 19:49:49', '2026-07-22 19:49:49'),
(7, 'REG', 'Registrar', '2026-07-22 19:49:49', '2026-07-22 19:49:49');

-- --------------------------------------------------------

--
-- Table structure for table `dept_heads_background_info`
--

CREATE TABLE `dept_heads_background_info` (
  `id` int(11) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `course_id` int(11) DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `employee_number` varchar(30) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `dept_heads_background_info`
--

INSERT INTO `dept_heads_background_info` (`id`, `user_id`, `course_id`, `department_id`, `employee_number`) VALUES
(1, 'd172639e-9b53-4857-99c6-e3c29512650f', 18, 3, NULL),
(2, '77b5b23b-ad35-4692-bf80-4fc21c7da67e', 17, 4, NULL),
(3, '180f878d-952b-41a0-8c8b-43e1dd7c10e5', NULL, 1, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `dtr_locations`
--

CREATE TABLE `dtr_locations` (
  `id` int(11) NOT NULL,
  `internship_id` char(36) NOT NULL,
  `set_by` char(36) NOT NULL,
  `lat` decimal(10,8) NOT NULL,
  `lon` decimal(11,8) NOT NULL,
  `radius_meters` int(11) NOT NULL DEFAULT 100,
  `label` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `dtr_locations`
--

INSERT INTO `dtr_locations` (`id`, `internship_id`, `set_by`, `lat`, `lon`, `radius_meters`, `label`, `created_at`, `updated_at`) VALUES
(1, 'de1ad170-1e49-44e5-9715-4f5877a5e243', '992650bc-e29a-493c-882c-25e1c8bb77db', 13.91478950, 121.43284230, 150, 'Jollibee near Tsuna\'s house', '2026-07-28 12:20:17', '2026-07-28 12:52:25');

-- --------------------------------------------------------

--
-- Table structure for table `employer_background_info`
--

CREATE TABLE `employer_background_info` (
  `id` int(11) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `company_name` varchar(150) DEFAULT NULL,
  `company_address` text DEFAULT NULL,
  `position` varchar(100) DEFAULT NULL,
  `contact_number` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- --------------------------------------------------------

--
-- Table structure for table `internship_documents`
--

CREATE TABLE `internship_documents` (
  `id` int(11) NOT NULL,
  `user_id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `file_name` varchar(50) NOT NULL,
  `company_name` varchar(50) NOT NULL,
  `category` varchar(10) NOT NULL,
  `url` text DEFAULT NULL,
  `path` varchar(255) NOT NULL,
  `file_type` varchar(100) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `internship_documents`
--

INSERT INTO `internship_documents` (`id`, `user_id`, `created_at`, `file_name`, `company_name`, `category`, `url`, `path`, `file_type`) VALUES
(29, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '2026-05-02 19:28:16', 'MOA', 'Accenture', 'before', 'https://zwtvevpjfsmqbqpzpxvj.supabase.co/storage/v1/object/public/eu-connect_storage/requirements/d67ff455-04a8-408b-9de0-1c3f6935a838/1777750095695.pdf', 'requirements/d67ff455-04a8-408b-9de0-1c3f6935a838/1777750095695.pdf', 'application/pdf'),
(30, 'cfddf97d-0d56-4e76-901f-bc3f8a40e042', '2026-05-18 17:44:26', 'MOA', 'Accenture', 'before', 'https://zwtvevpjfsmqbqpzpxvj.supabase.co/storage/v1/object/public/eu-connect_storage/requirements/cfddf97d-0d56-4e76-901f-bc3f8a40e042/1779126265476.pdf', 'requirements/cfddf97d-0d56-4e76-901f-bc3f8a40e042/1779126265476.pdf', 'application/pdf');

-- --------------------------------------------------------

--
-- Table structure for table `internship_records`
--

CREATE TABLE `internship_records` (
  `id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `user_id` char(36) DEFAULT NULL,
  `company_name` varchar(250) DEFAULT NULL,
  `internship_position` varchar(100) DEFAULT NULL,
  `description` text DEFAULT NULL,
  `company_address` varchar(255) NOT NULL,
  `company_website` varchar(255) DEFAULT NULL,
  `status` enum('pending','ongoing','rejected','finished') DEFAULT 'pending',
  `date_started` date DEFAULT NULL,
  `date_ended` date DEFAULT NULL,
  `total_hours` float DEFAULT 0,
  `accumulated_hours` float NOT NULL DEFAULT 0,
  `lon` decimal(11,8) DEFAULT NULL,
  `lat` decimal(10,8) DEFAULT NULL,
  `region_id` int(11) DEFAULT NULL,
  `deleted_at` timestamp NULL DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `internship_records`
--

INSERT INTO `internship_records` (`id`, `created_at`, `user_id`, `company_name`, `internship_position`, `description`, `company_address`, `company_website`, `status`, `date_started`, `date_ended`, `total_hours`, `accumulated_hours`, `lon`, `lat`, `region_id`, `deleted_at`, `updated_at`) VALUES
('de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-26 02:30:54', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'Accenture', 'SE intern', 'Assisting software engineers on A.P.I endpoints', 'Accenture, Campus Avenue, McKinley Hill, Pinagsama, Taguig District 2, Taguig, Southern Manila District, Metro Manila, 1630, Philippines', NULL, 'ongoing', '2026-07-27', NULL, 200, 12.8772, 121.05218050, 14.53101760, 15, NULL, '2026-07-26 02:31:20'),
('fb701586-9d98-4613-a91b-bea93680389a', '2026-07-25 18:47:34', '4cae9016-9c2d-447a-9421-70028ba071d8', 'Jollibee', 'Assistant chef', 'Assisting cooks in kitchen works', 'Jollibee, San Juan-Candelaria Road, Malabanban Sur, San Andres, Candelaria, 2nd District, Quezon, Calabarzon, 4323, Philippines', NULL, 'ongoing', '2026-07-27', NULL, 200, 0, 121.43284230, 13.91478950, 4, NULL, '2026-07-25 18:48:14');

-- --------------------------------------------------------

--
-- Table structure for table `notifications`
--

CREATE TABLE `notifications` (
  `id` int(11) NOT NULL,
  `user_id` char(36) NOT NULL,
  `sender_id` char(36) DEFAULT NULL,
  `type` enum('submission','approved','rejected','announcement','evaluation_deleted') NOT NULL,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `link` int(11) DEFAULT NULL,
  `link_uuid` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `notifications`
--

INSERT INTO `notifications` (`id`, `user_id`, `sender_id`, `type`, `title`, `message`, `is_read`, `link`, `link_uuid`, `created_at`) VALUES
(1, 'd172639e-9b53-4857-99c6-e3c29512650f', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'submission', 'New Internship Request', 'New request from Tsunayoshi Sawada', 1, 40, NULL, '2026-07-23 00:04:47'),
(2, 'fc5e18a8-2b0a-4b12-a226-851058374c65', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'submission', 'New Internship Request', 'New request from Tsunayoshi Sawada', 1, 40, NULL, '2026-07-23 00:04:47'),
(3, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'd172639e-9b53-4857-99c6-e3c29512650f', 'approved', 'Internship Record Approved', 'Your internship at Accenture has been approved by Kobe Bryant!', 0, 40, NULL, '2026-07-23 00:19:06'),
(4, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '992650bc-e29a-493c-882c-25e1c8bb77db', 'submission', 'Verify Your Evaluation', 'Franky Cyborg from Accenture has submitted your internship evaluation. Please confirm this was your actual supervisor to finalize your grade.', 0, 40, '502e107d-4721-46e0-80a8-8faae6bfe3ba', '2026-07-23 00:20:10'),
(10, '180f878d-952b-41a0-8c8b-43e1dd7c10e5', '4cae9016-9c2d-447a-9421-70028ba071d8', 'submission', 'New Internship Request', 'New request from Juan Dela Cruz', 1, 43, NULL, '2026-07-23 22:36:30'),
(11, 'fc5e18a8-2b0a-4b12-a226-851058374c65', '4cae9016-9c2d-447a-9421-70028ba071d8', 'submission', 'New Internship Request', 'New request from Juan Dela Cruz', 1, 43, NULL, '2026-07-23 22:36:30'),
(12, '4cae9016-9c2d-447a-9421-70028ba071d8', 'fc5e18a8-2b0a-4b12-a226-851058374c65', 'approved', 'Internship Record Approved', 'Your internship at Jollibee has been approved by Aeron Delen!', 1, 43, NULL, '2026-07-23 23:07:13'),
(13, '180f878d-952b-41a0-8c8b-43e1dd7c10e5', '4cae9016-9c2d-447a-9421-70028ba071d8', 'submission', 'New Internship Request', 'New request from Juan Dela Cruz', 0, NULL, 'fb701586-9d98-4613-a91b-bea93680389a', '2026-07-25 18:47:34'),
(14, 'fc5e18a8-2b0a-4b12-a226-851058374c65', '4cae9016-9c2d-447a-9421-70028ba071d8', 'submission', 'New Internship Request', 'New request from Juan Dela Cruz', 0, NULL, 'fb701586-9d98-4613-a91b-bea93680389a', '2026-07-25 18:47:34'),
(15, '4cae9016-9c2d-447a-9421-70028ba071d8', '180f878d-952b-41a0-8c8b-43e1dd7c10e5', 'approved', 'Internship Record Approved', 'Your internship at Jollibee has been approved by Kai Cenat!', 0, 0, NULL, '2026-07-25 18:48:14'),
(16, 'd172639e-9b53-4857-99c6-e3c29512650f', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'submission', 'New Internship Request', 'New request from Tsunayoshi Sawada', 0, NULL, 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-26 02:30:54'),
(17, 'fc5e18a8-2b0a-4b12-a226-851058374c65', 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'submission', 'New Internship Request', 'New request from Tsunayoshi Sawada', 0, NULL, 'de1ad170-1e49-44e5-9715-4f5877a5e243', '2026-07-26 02:30:54'),
(18, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'd172639e-9b53-4857-99c6-e3c29512650f', 'approved', 'Internship Record Approved', 'Your internship at Accenture has been approved by Kobe Bryant!', 1, 0, NULL, '2026-07-26 02:31:20'),
(19, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '992650bc-e29a-493c-882c-25e1c8bb77db', 'submission', 'Verify Your Evaluation', 'Franky Cyborg from Accenture has submitted your internship evaluation. Please confirm this was your actual supervisor to finalize your grade.', 0, 0, '417e0c1a-f02c-4371-99a0-7747dd2629e6', '2026-07-29 01:21:49');

-- --------------------------------------------------------

--
-- Table structure for table `regions`
--

CREATE TABLE `regions` (
  `id` int(11) NOT NULL,
  `region_name` varchar(100) NOT NULL,
  `short_name` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `regions`
--

INSERT INTO `regions` (`id`, `region_name`, `short_name`) VALUES
(1, 'Region I – Ilocos Region', 'Region I'),
(2, 'Region II – Cagayan Valley', 'Region II'),
(3, 'Region III – Central Luzon', 'Region III'),
(4, 'Region IV-A – CALABARZON', 'Region IV-A'),
(5, 'MIMAROPA Region', 'MIMAROPA'),
(6, 'Region V – Bicol Region', 'Region V'),
(7, 'Region VI – Western Visayas', 'Region VI'),
(8, 'Region VII – Central Visayas', 'Region VII'),
(9, 'Region VIII – Eastern Visayas', 'Region VIII'),
(10, 'Region IX – Zamboanga Peninsula', 'Region IX'),
(11, 'Region X – Northern Mindanao', 'Region X'),
(12, 'Region XI – Davao Region', 'Region XI'),
(13, 'Region XII – SOCCSKSARGEN', 'Region XII'),
(14, 'Region XIII – Caraga', 'Region XIII'),
(15, 'NCR – National Capital Region', 'NCR'),
(16, 'CAR – Cordillera Administrative Region', 'CAR'),
(17, 'BARMM – Bangsamoro Autonomous Region in Muslim Mindanao', 'BARMM'),
(18, 'NIR – Negros Island Region', 'NIR');

-- --------------------------------------------------------

--
-- Table structure for table `roles`
--

CREATE TABLE `roles` (
  `id` int(11) NOT NULL,
  `role` varchar(20) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `roles`
--

INSERT INTO `roles` (`id`, `role`) VALUES
(1, 'student'),
(2, 'employer'),
(3, 'department_head'),
(4, 'admin');

-- --------------------------------------------------------

--
-- Table structure for table `search_history`
--

CREATE TABLE `search_history` (
  `id` int(11) NOT NULL,
  `user_id` char(36) NOT NULL,
  `type` varchar(50) NOT NULL,
  `searched_id` int(11) DEFAULT NULL,
  `searched_uuid` char(36) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `search_history`
--

INSERT INTO `search_history` (`id`, `user_id`, `type`, `searched_id`, `searched_uuid`, `created_at`, `updated_at`) VALUES
(6, '992650bc-e29a-493c-882c-25e1c8bb77db', 'user', NULL, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '2026-07-23 00:18:55', '2026-07-26 23:41:38'),
(7, 'fc5e18a8-2b0a-4b12-a226-851058374c65', 'user', NULL, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '2026-07-24 22:43:57', '2026-07-24 22:43:57'),
(8, '180f878d-952b-41a0-8c8b-43e1dd7c10e5', 'user', NULL, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '2026-07-25 18:51:24', '2026-07-25 18:51:24'),
(11, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'user', NULL, 'd67ff455-04a8-408b-9de0-1c3f6935a838', '2026-07-28 23:58:02', '2026-07-28 23:58:02');

-- --------------------------------------------------------

--
-- Table structure for table `student_academic_info`
--

CREATE TABLE `student_academic_info` (
  `id` int(11) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `course_id` int(11) DEFAULT NULL,
  `department_id` int(11) DEFAULT NULL,
  `student_number` varchar(30) DEFAULT NULL,
  `year_level` varchar(15) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `student_academic_info`
--

INSERT INTO `student_academic_info` (`id`, `user_id`, `course_id`, `department_id`, `student_number`, `year_level`) VALUES
(15, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 18, 3, NULL, NULL),
(16, 'cfddf97d-0d56-4e76-901f-bc3f8a40e042', 18, 3, NULL, NULL),
(17, 'fc68779d-439b-43b9-b974-e7636c0ebdd6', 18, 3, NULL, NULL),
(18, 'c27be9a8-59cc-4314-8427-6a0eff9c34c1', 17, 4, NULL, NULL),
(19, '4cae9016-9c2d-447a-9421-70028ba071d8', 34, 1, NULL, NULL);

-- --------------------------------------------------------

--
-- Table structure for table `student_evaluation_criteria`
--

CREATE TABLE `student_evaluation_criteria` (
  `id` int(11) NOT NULL,
  `category` varchar(100) NOT NULL,
  `criterion_name` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `student_evaluation_criteria`
--

INSERT INTO `student_evaluation_criteria` (`id`, `category`, `criterion_name`) VALUES
(1, '1. Personality', 'Grooming'),
(2, '1. Personality', 'Physical Manners'),
(3, '1. Personality', 'Voice and Diction'),
(4, '1. Personality', 'Hygiene'),
(5, '2. Work Attitude', 'Attendance'),
(6, '2. Work Attitude', 'Punctuality'),
(7, '2. Work Attitude', 'Willingness to Accept Work'),
(8, '2. Work Attitude', 'Can Work Hard and Concentrate on the Work on Hand'),
(9, '2. Work Attitude', 'Willingness to Work on Extended Hours'),
(10, '2. Work Attitude', 'Cooperative to Officemates'),
(11, '2. Work Attitude', 'Has Self-Discipline'),
(12, '2. Work Attitude', 'Honest and Trustworthy'),
(13, '3. Work Organization', 'Accurate and Thorough in His/Her Work'),
(14, '3. Work Organization', 'Checks and Prioritizes Materials to Work on Before Starting'),
(15, '3. Work Organization', 'Keeps Materials to Work on Properly Arranged'),
(16, '3. Work Organization', 'Can Be Depended Upon to Finish Assigned Tasks on Time and Follow Instructions'),
(17, '3. Work Organization', 'Shows Creativity in His/Her Work'),
(18, '3. Work Organization', 'Can Detect Errors and Correct Them'),
(19, '3. Work Organization', 'Work Is Presentable and Acceptable'),
(20, '3. Work Organization', 'Consistent and Maintains Rate of Work'),
(21, '3. Work Organization', 'Judgment Can Be Depended Upon Even Under Stress'),
(22, '4. Job Knowledge', 'Learned About His/Her Job'),
(23, '4. Job Knowledge', 'Knows the Function, Requirements and Responsibilities Involved'),
(24, '4. Job Knowledge', 'Can Grasp Situations and Draw Correct Conclusions'),
(25, '5. Social Attitude', 'Friendly'),
(26, '5. Social Attitude', 'Shows Sincerity'),
(27, '5. Social Attitude', 'Polite and Tactful'),
(28, '6. Efficiency', 'Typing, Filing, Organization Works, Front Desk Procedures'),
(29, '6. Efficiency', 'Communication (Answering Telephone Calls, Reception Work, etc.)');

-- --------------------------------------------------------

--
-- Table structure for table `student_evaluation_masters`
--

CREATE TABLE `student_evaluation_masters` (
  `id` char(36) NOT NULL,
  `internship_record_id` char(36) DEFAULT NULL,
  `evaluated_by` char(36) NOT NULL,
  `other_remarks` text DEFAULT NULL,
  `status` enum('pending','completed') DEFAULT 'pending',
  `created_at` datetime DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `student_evaluation_masters`
--

INSERT INTO `student_evaluation_masters` (`id`, `internship_record_id`, `evaluated_by`, `other_remarks`, `status`, `created_at`) VALUES
('417e0c1a-f02c-4371-99a0-7747dd2629e6', 'de1ad170-1e49-44e5-9715-4f5877a5e243', '992650bc-e29a-493c-882c-25e1c8bb77db', 'dasda asda asd asd asd', 'pending', '2026-07-29 09:21:49');

-- --------------------------------------------------------

--
-- Table structure for table `student_evaluation_scores`
--

CREATE TABLE `student_evaluation_scores` (
  `id` int(11) NOT NULL,
  `evaluation_master_id` char(36) NOT NULL,
  `criterion_id` int(11) NOT NULL,
  `score` tinyint(4) NOT NULL CHECK (`score` between 0 and 5)
) ;

--
-- Dumping data for table `student_evaluation_scores`
--

INSERT INTO `student_evaluation_scores` (`id`, `evaluation_master_id`, `criterion_id`, `score`) VALUES
(30, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 1, 5),
(31, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 2, 4),
(32, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 3, 4),
(33, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 4, 5),
(34, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 5, 5),
(35, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 6, 5),
(36, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 7, 4),
(37, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 8, 5),
(38, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 9, 4),
(39, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 10, 5),
(40, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 11, 4),
(41, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 12, 5),
(42, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 13, 5),
(43, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 14, 5),
(44, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 15, 5),
(45, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 16, 5),
(46, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 17, 5),
(47, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 18, 5),
(48, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 19, 5),
(49, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 20, 5),
(50, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 21, 5),
(51, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 22, 5),
(52, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 23, 5),
(53, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 24, 5),
(54, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 25, 5),
(55, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 26, 5),
(56, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 27, 5),
(57, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 28, 5),
(58, '417e0c1a-f02c-4371-99a0-7747dd2629e6', 29, 0);

-- --------------------------------------------------------

--
-- Table structure for table `users`
--

CREATE TABLE `users` (
  `id` char(36) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `email` varchar(50) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `role_id` int(11) DEFAULT NULL,
  `account_locked_until` timestamp NULL DEFAULT NULL,
  `failed_login_attempts` int(11) DEFAULT 0,
  `status` enum('active','inactive','suspended') DEFAULT 'active',
  `deleted_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `users`
--

INSERT INTO `users` (`id`, `created_at`, `email`, `password_hash`, `role_id`, `account_locked_until`, `failed_login_attempts`, `status`, `deleted_at`) VALUES
('180f878d-952b-41a0-8c8b-43e1dd7c10e5', '2026-07-22 23:09:45', 'kc@email.com', '$2b$10$rV4bnryt80yme2soStgiGON0u8vJIac17Xsttt4HFrvo6dqMlgtxK', 3, NULL, 0, 'active', NULL),
('4cae9016-9c2d-447a-9421-70028ba071d8', '2026-07-23 18:20:31', 'jdc@email.com', '$2b$10$4GbseyQaZNWfo8.NXFBoGe4ipYlztDdyT/p22BNwQe0iAzUHpF2va', 1, NULL, 0, 'active', NULL),
('77b5b23b-ad35-4692-bf80-4fc21c7da67e', '2026-05-01 12:07:22', 'k_ayanokoji@email.com', '$2b$10$LTv4r3HsH5TWC56Ylsw25ewCSuoqStPc8oXPRlwNLAj5AOKXz/aBC', 3, NULL, 0, 'active', NULL),
('992650bc-e29a-493c-882c-25e1c8bb77db', '2026-05-26 22:52:58', 'cfranky@email.com', '$2b$10$cmQ8M/6uFt.SuZvbZhgEt.TO9g0/L8U5Ok8pAF2M0MEouCtV1/Ypi', 2, NULL, 0, 'active', NULL),
('c27be9a8-59cc-4314-8427-6a0eff9c34c1', '2026-07-22 23:11:47', 'lm@email.com', '$2b$10$WFB8KU9rVJe7xM3yhOT9XeictbrLSj2UYNZv1qCKo5hBVXaf0LvLu', 1, NULL, 0, 'active', NULL),
('cfddf97d-0d56-4e76-901f-bc3f8a40e042', '2026-05-08 16:43:51', 'Kagami_t@email.com', '$2b$10$PEVneaOZDVoOAVQ4GlGp0ucOvmp.kIQ2IhHs0p0D9p1yU5iOMJS92', 1, NULL, 0, 'active', NULL),
('d172639e-9b53-4857-99c6-e3c29512650f', '2026-05-01 11:30:01', 'kobe24@email.com', '$2b$10$XSK/QPRkjEFeIoomzwykL.rmcCgYGW6gJSAZvzfs3844/fCcIobbe', 3, NULL, 0, 'active', NULL),
('d67ff455-04a8-408b-9de0-1c3f6935a838', '2026-05-01 11:32:00', 'tsawada@email.com', '$2b$10$42ZEIh7TIDmjSBfW2zpPAe1p4YUBd2us.DNQh9d/O5CfeSsp0Axg2', 1, NULL, 0, 'active', NULL),
('fc5e18a8-2b0a-4b12-a226-851058374c65', '2026-04-04 01:32:25', 'admin1@email.com', '$2b$10$PudjpT3/MNzVLptfZxThPOGmXvSXa/pBzhJjFFTzVSc4NBuyMkmhC', 4, NULL, 0, 'active', NULL),
('fc68779d-439b-43b9-b974-e7636c0ebdd6', '2026-05-15 16:51:49', 'uchiha_s@email.com', '$2b$10$WLBm3xx4KkFnOMfv4ePRVOPVA0uFLwGNIFOAPaV9hH4Q0mnxN/lCS', 1, NULL, 0, 'active', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `user_profiles`
--

CREATE TABLE `user_profiles` (
  `id` int(11) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `first_name` varchar(50) NOT NULL,
  `last_name` varchar(50) NOT NULL,
  `contact_number` char(13) DEFAULT NULL,
  `full_address` text DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `user_profiles`
--

INSERT INTO `user_profiles` (`id`, `user_id`, `first_name`, `last_name`, `contact_number`, `full_address`) VALUES
(16, 'fc5e18a8-2b0a-4b12-a226-851058374c65', 'Aeron', 'Delen', NULL, NULL),
(22, 'd172639e-9b53-4857-99c6-e3c29512650f', 'Kobe', 'Bryant', NULL, NULL),
(23, 'd67ff455-04a8-408b-9de0-1c3f6935a838', 'Tsunayoshi', 'Sawada', NULL, NULL),
(24, '77b5b23b-ad35-4692-bf80-4fc21c7da67e', 'Kiyotaka', 'Ayanokoji', NULL, NULL),
(25, 'cfddf97d-0d56-4e76-901f-bc3f8a40e042', 'Taiga', 'Kagami', NULL, NULL),
(26, 'fc68779d-439b-43b9-b974-e7636c0ebdd6', 'Sasuke', 'Uchiha', NULL, NULL),
(27, '992650bc-e29a-493c-882c-25e1c8bb77db', 'Franky', 'Cyborg', NULL, NULL),
(28, '180f878d-952b-41a0-8c8b-43e1dd7c10e5', 'Kai', 'Cenat', NULL, NULL),
(29, 'c27be9a8-59cc-4314-8427-6a0eff9c34c1', 'Luffy', 'Monkey', NULL, NULL),
(30, '4cae9016-9c2d-447a-9421-70028ba071d8', 'Juan', 'Dela Cruz', NULL, NULL);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `announcements`
--
ALTER TABLE `announcements`
  ADD PRIMARY KEY (`id`),
  ADD KEY `category_id` (`category_id`),
  ADD KEY `author_id` (`author_id`);

--
-- Indexes for table `announcement_categories`
--
ALTER TABLE `announcement_categories`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`);

--
-- Indexes for table `courses`
--
ALTER TABLE `courses`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `course_name` (`course_name`) USING HASH;

--
-- Indexes for table `daily_narratives`
--
ALTER TABLE `daily_narratives`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_users_id_dn` (`user_id`) USING BTREE,
  ADD KEY `fk_daily_narratives_internship_records` (`internship_id`);

--
-- Indexes for table `daily_time_records`
--
ALTER TABLE `daily_time_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_dtr_user_id` (`user_id`),
  ADD KEY `fk_daily_time_records_internship_records` (`internship_id`);

--
-- Indexes for table `departments`
--
ALTER TABLE `departments`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `code` (`code`);

--
-- Indexes for table `dept_heads_background_info`
--
ALTER TABLE `dept_heads_background_info`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_dept_user` (`user_id`),
  ADD KEY `fk_dept_course` (`course_id`),
  ADD KEY `fk_dept_heads_background_info` (`department_id`);

--
-- Indexes for table `dtr_locations`
--
ALTER TABLE `dtr_locations`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_internship_location` (`internship_id`),
  ADD KEY `fk_dtr_locations_users` (`set_by`);

--
-- Indexes for table `employer_background_info`
--
ALTER TABLE `employer_background_info`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_employer_user` (`user_id`);

--
-- Indexes for table `internship_documents`
--
ALTER TABLE `internship_documents`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_user_id_storage` (`user_id`);

--
-- Indexes for table `internship_records`
--
ALTER TABLE `internship_records`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_user_id` (`user_id`);

--
-- Indexes for table `notifications`
--
ALTER TABLE `notifications`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
-- Indexes for table `regions`
--
ALTER TABLE `regions`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `roles`
--
ALTER TABLE `roles`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `search_history`
--
ALTER TABLE `search_history`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_user_history_by_type` (`user_id`,`type`,`created_at`);

--
-- Indexes for table `student_academic_info`
--
ALTER TABLE `student_academic_info`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_id` (`user_id`),
  ADD KEY `fk_student_course_id` (`course_id`),
  ADD KEY `fk_student_academic_department` (`department_id`);

--
-- Indexes for table `student_evaluation_criteria`
--
ALTER TABLE `student_evaluation_criteria`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `student_evaluation_masters`
--
ALTER TABLE `student_evaluation_masters`
  ADD PRIMARY KEY (`id`),
  ADD KEY `fk_student_evaluation_masters_internship_records` (`internship_record_id`);

--
-- Indexes for table `student_evaluation_scores`
--
ALTER TABLE `student_evaluation_scores`
  ADD PRIMARY KEY (`id`),
  ADD KEY `evaluation_master_id` (`evaluation_master_id`),
  ADD KEY `criterion_id` (`criterion_id`);

--
-- Indexes for table `users`
--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `role_id` (`role_id`);

--
-- Indexes for table `user_profiles`
--
ALTER TABLE `user_profiles`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `user_id` (`user_id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `announcements`
--
ALTER TABLE `announcements`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `announcement_categories`
--
ALTER TABLE `announcement_categories`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `courses`
--
ALTER TABLE `courses`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=38;

--
-- AUTO_INCREMENT for table `daily_narratives`
--
ALTER TABLE `daily_narratives`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=13;

--
-- AUTO_INCREMENT for table `daily_time_records`
--
ALTER TABLE `daily_time_records`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `departments`
--
ALTER TABLE `departments`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `dept_heads_background_info`
--
ALTER TABLE `dept_heads_background_info`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `dtr_locations`
--
ALTER TABLE `dtr_locations`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=2;

--
-- AUTO_INCREMENT for table `employer_background_info`
--
ALTER TABLE `employer_background_info`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `internship_documents`
--
ALTER TABLE `internship_documents`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

--
-- AUTO_INCREMENT for table `notifications`
--
ALTER TABLE `notifications`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT for table `regions`
--
ALTER TABLE `regions`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=19;

--
-- AUTO_INCREMENT for table `roles`
--
ALTER TABLE `roles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `search_history`
--
ALTER TABLE `search_history`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=12;

--
-- AUTO_INCREMENT for table `student_academic_info`
--
ALTER TABLE `student_academic_info`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=20;

--
-- AUTO_INCREMENT for table `student_evaluation_criteria`
--
ALTER TABLE `student_evaluation_criteria`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=30;

--
-- AUTO_INCREMENT for table `student_evaluation_scores`
--
ALTER TABLE `student_evaluation_scores`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `user_profiles`
--
ALTER TABLE `user_profiles`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=31;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `announcements`
--
ALTER TABLE `announcements`
  ADD CONSTRAINT `announcements_ibfk_1` FOREIGN KEY (`category_id`) REFERENCES `announcement_categories` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `announcements_ibfk_2` FOREIGN KEY (`author_id`) REFERENCES `users` (`id`);

--
-- Constraints for table `daily_narratives`
--
ALTER TABLE `daily_narratives`
  ADD CONSTRAINT `fk_daily_narratives_internship_records` FOREIGN KEY (`internship_id`) REFERENCES `internship_records` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_users_dn` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `daily_time_records`
--
ALTER TABLE `daily_time_records`
  ADD CONSTRAINT `fk_daily_time_records_internship_records` FOREIGN KEY (`internship_id`) REFERENCES `internship_records` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `fk_dtr_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `dept_heads_background_info`
--
ALTER TABLE `dept_heads_background_info`
  ADD CONSTRAINT `fk_dept_course` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_dept_heads_background_info` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_dept_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `dtr_locations`
--
ALTER TABLE `dtr_locations`
  ADD CONSTRAINT `fk_dtr_locations_internship_records` FOREIGN KEY (`internship_id`) REFERENCES `internship_records` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_dtr_locations_users` FOREIGN KEY (`set_by`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

--
-- Constraints for table `employer_background_info`
--
ALTER TABLE `employer_background_info`
  ADD CONSTRAINT `fk_employer_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `internship_documents`
--
ALTER TABLE `internship_documents`
  ADD CONSTRAINT `fk_user_id_storage` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `internship_records`
--
ALTER TABLE `internship_records`
  ADD CONSTRAINT `fk_user_id` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `notifications`
--
ALTER TABLE `notifications`
  ADD CONSTRAINT `notifications_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `search_history`
--
ALTER TABLE `search_history`
  ADD CONSTRAINT `fk_search_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `student_academic_info`
--
ALTER TABLE `student_academic_info`
  ADD CONSTRAINT `fk_student_academic_department` FOREIGN KEY (`department_id`) REFERENCES `departments` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_student_course_id` FOREIGN KEY (`course_id`) REFERENCES `courses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_user_id_acad_info` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `student_evaluation_masters`
--
ALTER TABLE `student_evaluation_masters`
  ADD CONSTRAINT `fk_student_evaluation_masters_internship_records` FOREIGN KEY (`internship_record_id`) REFERENCES `internship_records` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `student_evaluation_scores`
--
ALTER TABLE `student_evaluation_scores`
  ADD CONSTRAINT `student_evaluation_scores_ibfk_1` FOREIGN KEY (`evaluation_master_id`) REFERENCES `student_evaluation_masters` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `student_evaluation_scores_ibfk_2` FOREIGN KEY (`criterion_id`) REFERENCES `student_evaluation_criteria` (`id`) ON DELETE CASCADE;

--
-- Constraints for table `users`
--
ALTER TABLE `users`
  ADD CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`id`);

--
-- Constraints for table `user_profiles`
--
ALTER TABLE `user_profiles`
  ADD CONSTRAINT `fk_user_profiles` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
