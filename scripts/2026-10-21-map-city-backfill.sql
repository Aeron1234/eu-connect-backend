-- EU-Connect city grouping migration, based on the supplied 2026-10-21 export.
-- Back up first. Run ONCE on the intended database BEFORE deploying the new backend.
-- The ALTER commits implicitly in MariaDB/MySQL; the following updates are transactional.
-- These are geographic province labels (including Metro Manila), not PSGC codes.
SET NAMES utf8mb4;
ALTER TABLE internship_records
  ADD COLUMN city_name VARCHAR(100) NULL AFTER company_address,
  ADD COLUMN province_name VARCHAR(100) NULL AFTER city_name;

START TRANSACTION;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '0af7ac07-11d4-4b06-808d-57ad70d1b8d0' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'PLDT Lucena, Doña Aurora Boulevard, Pag-asa, Gulang-Gulang, Lucena, 2nd District, Calabarzon, 4301, Philippines'
  AND lat <=> 13.94451650 AND lon <=> 121.61354530;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = '1c2bf790-a288-4d45-9e4f-308693692734' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Accenture, 11th Drive, Bonifacio Global City, Fort Bonifacio, Taguig District 2, Taguig, Southern Manila District, Metro Manila, 1635, Philippines'
  AND lat <=> 14.55592470 AND lon <=> 121.05441730;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = '2995a6d2-2371-4127-8841-dd2cf87dae27' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Phoenix Petroleum, 4th Avenue, Bonifacio Global City, Fort Bonifacio, Taguig District 2, Taguig, Southern Manila District, Metro Manila, 1634, Philippines'
  AND lat <=> 14.54816620 AND lon <=> 121.04580760;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '46625f96-8306-4f6f-96e3-12fa55f3f3e0' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'PLDT Lucena, Doña Aurora Boulevard, Pag-asa, Gulang-Gulang, Lucena, 2nd District, Calabarzon, 4301, Philippines'
  AND lat <=> 13.94451650 AND lon <=> 121.61354530;

UPDATE internship_records SET city_name = 'Candelaria', province_name = 'Quezon'
WHERE id = '4a14ac2c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Candelaria, Quezon, Philippines'
  AND lat <=> 13.93400000 AND lon <=> 121.42300000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14af73-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Batangas City', province_name = 'Batangas'
WHERE id = '4a14b0ae-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Batangas City, Batangas, Philippines'
  AND lat <=> 13.75600000 AND lon <=> 121.05800000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14b16f-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Candelaria', province_name = 'Quezon'
WHERE id = '4a14b286-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Candelaria, Quezon, Philippines'
  AND lat <=> 13.93400000 AND lon <=> 121.42300000;

UPDATE internship_records SET city_name = 'Calamba City', province_name = 'Laguna'
WHERE id = '4a14b363-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Calamba City, Laguna, Philippines'
  AND lat <=> 14.21100000 AND lon <=> 121.16600000;

UPDATE internship_records SET city_name = 'Makati City', province_name = 'Metro Manila'
WHERE id = '4a14b3e0-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Makati City, Metro Manila, Philippines'
  AND lat <=> 14.55470000 AND lon <=> 121.02440000;

UPDATE internship_records SET city_name = 'San Pablo City', province_name = 'Laguna'
WHERE id = '4a14b499-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Pablo City, Laguna, Philippines'
  AND lat <=> 14.06800000 AND lon <=> 121.32500000;

UPDATE internship_records SET city_name = 'Tagaytay City', province_name = 'Cavite'
WHERE id = '4a14b55b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Tagaytay City, Cavite, Philippines'
  AND lat <=> 14.10000000 AND lon <=> 120.93300000;

UPDATE internship_records SET city_name = 'San Pablo City', province_name = 'Laguna'
WHERE id = '4a14b618-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Pablo City, Laguna, Philippines'
  AND lat <=> 14.06800000 AND lon <=> 121.32500000;

UPDATE internship_records SET city_name = 'Batangas City', province_name = 'Batangas'
WHERE id = '4a14b68c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Batangas City, Batangas, Philippines'
  AND lat <=> 13.75600000 AND lon <=> 121.05800000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14b74a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Batangas City', province_name = 'Batangas'
WHERE id = '4a14b7ed-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Batangas City, Batangas, Philippines'
  AND lat <=> 13.75600000 AND lon <=> 121.05800000;

UPDATE internship_records SET city_name = 'Dasmariñas City', province_name = 'Cavite'
WHERE id = '4a14b8c8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Dasmarinas City, Cavite, Philippines'
  AND lat <=> 14.32940000 AND lon <=> 120.93670000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14b95d-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Makati City', province_name = 'Metro Manila'
WHERE id = '4a14ba37-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Makati City, Metro Manila, Philippines'
  AND lat <=> 14.55470000 AND lon <=> 121.02440000;

UPDATE internship_records SET city_name = 'Batangas City', province_name = 'Batangas'
WHERE id = '4a14bac9-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Batangas City, Batangas, Philippines'
  AND lat <=> 13.75600000 AND lon <=> 121.05800000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14bb72-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'San Pablo City', province_name = 'Laguna'
WHERE id = '4a14bc0e-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Pablo City, Laguna, Philippines'
  AND lat <=> 14.06800000 AND lon <=> 121.32500000;

UPDATE internship_records SET city_name = 'Calamba City', province_name = 'Laguna'
WHERE id = '4a14bcc1-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Calamba City, Laguna, Philippines'
  AND lat <=> 14.21100000 AND lon <=> 121.16600000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14bd57-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14bdf5-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14be9b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Dasmariñas City', province_name = 'Cavite'
WHERE id = '4a14bf3c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Dasmarinas City, Cavite, Philippines'
  AND lat <=> 14.32940000 AND lon <=> 120.93670000;

UPDATE internship_records SET city_name = 'Puerto Princesa City', province_name = 'Palawan'
WHERE id = '4a14bff1-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Puerto Princesa, Palawan, Philippines'
  AND lat <=> 9.73920000 AND lon <=> 118.73530000;

UPDATE internship_records SET city_name = 'Santa Rosa City', province_name = 'Laguna'
WHERE id = '4a14c093-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Santa Rosa City, Laguna, Philippines'
  AND lat <=> 14.31220000 AND lon <=> 121.11140000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14c1cf-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14c280-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14c32b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14c3a5-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'San Fernando City', province_name = 'Pampanga'
WHERE id = '4a14c40c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Fernando City, Pampanga, Philippines'
  AND lat <=> 15.02800000 AND lon <=> 120.68900000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14c48d-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14c4da-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14c547-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14c5a4-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Tagbilaran City', province_name = 'Bohol'
WHERE id = '4a14c610-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Tagbilaran City, Bohol, Philippines'
  AND lat <=> 9.64740000 AND lon <=> 123.85540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14c66f-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14c6e0-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14c72b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14c780-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Dasmariñas City', province_name = 'Cavite'
WHERE id = '4a14c7f2-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Dasmarinas City, Cavite, Philippines'
  AND lat <=> 14.32940000 AND lon <=> 120.93670000;

UPDATE internship_records SET city_name = 'Santa Rosa City', province_name = 'Laguna'
WHERE id = '4a14c857-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Santa Rosa City, Laguna, Philippines'
  AND lat <=> 14.31220000 AND lon <=> 121.11140000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14c8ca-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14c92d-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14c978-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = '4a14c9ea-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Taguig City, Metro Manila, Philippines'
  AND lat <=> 14.55000000 AND lon <=> 121.05000000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14ca47-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14ca98-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14cb0c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14cb68-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'San Pablo City', province_name = 'Laguna'
WHERE id = '4a14cbc8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Pablo City, Laguna, Philippines'
  AND lat <=> 14.06800000 AND lon <=> 121.32500000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14cc2a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14cc98-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14cd00-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14cd64-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14cdba-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14ce10-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14ce87-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Tagbilaran City', province_name = 'Bohol'
WHERE id = '4a14cef9-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Tagbilaran City, Bohol, Philippines'
  AND lat <=> 9.64740000 AND lon <=> 123.85540000;

UPDATE internship_records SET city_name = 'San Fernando City', province_name = 'Pampanga'
WHERE id = '4a14cf53-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Fernando City, Pampanga, Philippines'
  AND lat <=> 15.02800000 AND lon <=> 120.68900000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14cfa9-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d014-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d085-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14d0db-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14d135-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14d195-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d1ed-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d263-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14d2c2-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14d311-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14d384-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Makati City', province_name = 'Metro Manila'
WHERE id = '4a14d3dd-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Makati City, Metro Manila, Philippines'
  AND lat <=> 14.55470000 AND lon <=> 121.02440000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14d431-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'San Pablo City', province_name = 'Laguna'
WHERE id = '4a14d486-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Pablo City, Laguna, Philippines'
  AND lat <=> 14.06800000 AND lon <=> 121.32500000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14d4da-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = '4a14d552-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Taguig City, Metro Manila, Philippines'
  AND lat <=> 14.55000000 AND lon <=> 121.05000000;

UPDATE internship_records SET city_name = 'Dasmariñas City', province_name = 'Cavite'
WHERE id = '4a14d5a6-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Dasmarinas City, Cavite, Philippines'
  AND lat <=> 14.32940000 AND lon <=> 120.93670000;

UPDATE internship_records SET city_name = 'Santa Rosa City', province_name = 'Laguna'
WHERE id = '4a14d607-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Santa Rosa City, Laguna, Philippines'
  AND lat <=> 14.31220000 AND lon <=> 121.11140000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14d666-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14d6d7-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14d72f-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d78d-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14d7d0-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14d826-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14d892-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14d8ed-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Makati City', province_name = 'Metro Manila'
WHERE id = '4a14d92f-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Makati City, Metro Manila, Philippines'
  AND lat <=> 14.55470000 AND lon <=> 121.02440000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14d9a8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14d9ec-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a14da4d-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14dabe-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'San Fernando City', province_name = 'Pampanga'
WHERE id = '4a14db0a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'San Fernando City, Pampanga, Philippines'
  AND lat <=> 15.02800000 AND lon <=> 120.68900000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14db70-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14dbd1-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a14dc43-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14dca0-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14dd10-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '4a14dd5c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '4a14dd9f-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '4a14de07-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Makati City', province_name = 'Metro Manila'
WHERE id = '4a14de7a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Makati City, Metro Manila, Philippines'
  AND lat <=> 14.55470000 AND lon <=> 121.02440000;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = '4a14dee0-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Taguig City, Metro Manila, Philippines'
  AND lat <=> 14.55000000 AND lon <=> 121.05000000;

UPDATE internship_records SET city_name = 'Lucena City', province_name = 'Quezon'
WHERE id = '4a14df26-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Lucena City, Quezon, Philippines'
  AND lat <=> 13.94000000 AND lon <=> 121.61500000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '4a14dfa1-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '4a15036b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Dasmariñas City', province_name = 'Cavite'
WHERE id = '4a150447-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Dasmarinas City, Cavite, Philippines'
  AND lat <=> 14.32940000 AND lon <=> 120.93670000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '4a1504d4-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Santa Rosa City', province_name = 'Laguna'
WHERE id = '4a15052a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Santa Rosa City, Laguna, Philippines'
  AND lat <=> 14.31220000 AND lon <=> 121.11140000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '56f71bf1-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f71dac-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f71e64-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '56f71ee7-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '56f71f53-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f71fbd-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f72059-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f720cc-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f7214e-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '56f721bf-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '56f72220-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f7228b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f722f8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '56f7236a-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Manila', province_name = 'Metro Manila'
WHERE id = '56f72498-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Manila, Metro Manila, Philippines'
  AND lat <=> 14.59950000 AND lon <=> 120.98420000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f72530-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f72708-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f72791-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f72853-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Iloilo City', province_name = 'Iloilo'
WHERE id = '56f728cd-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Iloilo City, Iloilo, Philippines'
  AND lat <=> 10.72020000 AND lon <=> 122.56210000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '56f7e948-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f7ea3b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f7ea98-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f7eadd-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '56f7eb23-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f7eb67-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f7eba8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f7ebe7-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Angeles City', province_name = 'Pampanga'
WHERE id = '56f7ec28-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Angeles City, Pampanga, Philippines'
  AND lat <=> 15.14500000 AND lon <=> 120.58870000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f7ec71-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f7ecac-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f7ece8-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f8b66b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f8b75c-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Quezon City', province_name = 'Metro Manila'
WHERE id = '56f8b7ce-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Quezon City, Metro Manila, Philippines'
  AND lat <=> 14.67600000 AND lon <=> 121.04370000;

UPDATE internship_records SET city_name = 'Cebu City', province_name = 'Cebu'
WHERE id = '56f8b841-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Cebu City, Cebu, Philippines'
  AND lat <=> 10.31570000 AND lon <=> 123.88540000;

UPDATE internship_records SET city_name = 'Davao City', province_name = 'Davao del Sur'
WHERE id = '56f8b88b-bfd5-11f1-9638-5bc6d2c76fd7' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Davao City, Davao del Sur, Philippines'
  AND lat <=> 7.19070000 AND lon <=> 125.45530000;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = 'd2c71cd9-e1cc-4e43-b0e9-1bae4efaf877' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Accenture, 11th Drive, Bonifacio Global City, Fort Bonifacio, Taguig District 2, Taguig, Southern Manila District, Metro Manila, 1635, Philippines'
  AND lat <=> 14.55592470 AND lon <=> 121.05441730;

UPDATE internship_records SET city_name = 'Taguig City', province_name = 'Metro Manila'
WHERE id = 'de1ad170-1e49-44e5-9715-4f5877a5e243' AND city_name IS NULL AND province_name IS NULL
  AND BINARY company_address = BINARY 'Accenture, Campus Avenue, McKinley Hill, Pinagsama, Taguig District 2, Taguig, Southern Manila District, Metro Manila, 1630, Philippines'
  AND lat <=> 14.53101760 AND lon <=> 121.05218050;

COMMIT;

-- Review after execution. On the unchanged supplied export, unclassified_records = 0.
-- New rows or locations changed since export are deliberately not guessed.
SELECT COUNT(*) AS unclassified_records FROM internship_records
WHERE city_name IS NULL OR province_name IS NULL;
SELECT id, company_name, company_address, lat, lon FROM internship_records
WHERE city_name IS NULL OR province_name IS NULL;
SELECT city_name, province_name, COUNT(*) AS records,
       COUNT(DISTINCT CASE WHEN status = 'ongoing' AND deleted_at IS NULL THEN user_id END) AS ongoing_students
FROM internship_records GROUP BY city_name, province_name ORDER BY ongoing_students DESC, city_name;
